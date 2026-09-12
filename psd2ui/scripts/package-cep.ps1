#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [string]$SigningTool = '',
    [string]$CertificatePath = '',
    [Security.SecureString]$CertificatePassword,
    [ValidateRange(1,3650)][int]$CertificateValidityDays = 3650,
    [string]$OutputDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskToolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskSigningRoot = Join-Path $taskToolRoot '.tmp/cep-signing'
$taskStagingRoot = Join-Path $taskToolRoot '.tmp/cep-packaging'
$taskExtensionId = 'com.yoyoengine.psd2ui.cep'
$taskInstallerRevision = 2
$taskToolUrl = 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/x64/ZXPSignCmd.exe'
$taskToolSha256 = 'FFC2223167225CE61D024EB463FC5AD1A1BE16133F99EF334A646F7311916C98'

# npm can pass PowerShell 7's PSModulePath unchanged to Windows PowerShell 5.1.
# Load this process's built-in security module without changing the environment.
Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

function Get-TaskSha256([string]$File) {
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function Assert-TaskChild([string]$Child, [string]$Parent) {
    $full = [IO.Path]::GetFullPath($Child)
    $root = [IO.Path]::GetFullPath($Parent).TrimEnd([char[]]'\/')
    if (-not $full.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the task directory: $full"
    }
    return $full
}
function Assert-TaskNoLinks([string]$Directory) {
    foreach ($item in @(Get-Item -LiteralPath $Directory -Force) + @(Get-ChildItem -LiteralPath $Directory -Recurse -Force)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse points cannot be signed or packaged: $($item.FullName)" }
    }
}
function Write-TaskUtf8([string]$File, [string]$Content) {
    [IO.File]::WriteAllText($File, $Content, (New-Object Text.UTF8Encoding($false)))
}
function Invoke-TaskSigning([string[]]$Arguments) {
    # OpenSSL may write a .rnd seed beside its working directory. Keep it private.
    Push-Location -LiteralPath $taskSigningRoot
    try {
        $output = @(& $script:ResolvedSigningTool @Arguments 2>&1)
        if ($LASTEXITCODE -ne 0) { throw "ZXPSignCmd failed (exit $LASTEXITCODE): $($output -join [Environment]::NewLine)" }
        return $output
    } finally { Pop-Location }
}

[IO.Directory]::CreateDirectory($taskSigningRoot) | Out-Null
[IO.Directory]::CreateDirectory($taskStagingRoot) | Out-Null
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskToolRoot 'dist' }
$taskOutputRoot = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($taskOutputRoot) | Out-Null
if (-not $SigningTool) {
    $SigningTool = Join-Path $taskSigningRoot 'ZXPSignCmd.exe'
    if (-not (Test-Path -LiteralPath $SigningTool -PathType Leaf)) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $taskToolUrl -OutFile $SigningTool
    }
    if ((Get-TaskSha256 $SigningTool) -ne $taskToolSha256) {
        throw 'Adobe ZXPSignCmd does not match the pinned official Windows 4.1.3 binary.'
    }
}
$script:ResolvedSigningTool = [IO.Path]::GetFullPath($SigningTool)
if (-not (Test-Path -LiteralPath $script:ResolvedSigningTool -PathType Leaf)) { throw 'ZXPSignCmd executable was not found.' }
if (-not $SkipBuild) {
    Push-Location -LiteralPath $taskToolRoot
    try {
        & node (Join-Path $PSScriptRoot 'build-cep.js')
        if ($LASTEXITCODE -ne 0) { throw 'CEP panel build failed.' }
    } finally { Pop-Location }
}

$taskPlainPassword = $null
$taskPasswordPointer = [IntPtr]::Zero
$taskWork = Assert-TaskChild (Join-Path $taskStagingRoot ([Guid]::NewGuid().ToString('N'))) $taskStagingRoot
[IO.Directory]::CreateDirectory($taskWork) | Out-Null
try {
    if (-not $CertificatePath) {
        $CertificatePath = Join-Path $taskSigningRoot 'internal-development.p12'
        $taskPasswordFile = Join-Path $taskSigningRoot 'internal-development.password.dpapi'
        if (Test-Path -LiteralPath $CertificatePath) {
            if (-not (Test-Path -LiteralPath $taskPasswordFile)) { throw 'The internal signing certificate exists but its DPAPI password file is missing.' }
            $CertificatePassword = ConvertTo-SecureString ([IO.File]::ReadAllText($taskPasswordFile).Trim())
        } else {
            $taskBytes = New-Object byte[] 32
            $taskRng = [Security.Cryptography.RandomNumberGenerator]::Create()
            try { $taskRng.GetBytes($taskBytes) } finally { $taskRng.Dispose() }
            $CertificatePassword = ConvertTo-SecureString ([Convert]::ToBase64String($taskBytes)) -AsPlainText -Force
            $CertificatePassword | ConvertFrom-SecureString | Set-Content -LiteralPath $taskPasswordFile -Encoding ASCII
        }
    } elseif (-not $CertificatePassword) { throw 'CertificatePassword is required with an explicit CertificatePath.' }
    $CertificatePath = [IO.Path]::GetFullPath($CertificatePath)
    $taskPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($CertificatePassword)
    $taskPlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPasswordPointer)
    if (-not (Test-Path -LiteralPath $CertificatePath)) {
        $null = Assert-TaskChild $CertificatePath $taskSigningRoot
        Invoke-TaskSigning @('-selfSignedCert', 'CN', 'Shanghai', 'YoyoRD', 'PSD2UI internal development',
            $taskPlainPassword, $CertificatePath, '-validityDays', [string]$CertificateValidityDays) | Out-Null
    }

    $taskPanelRoot = Join-Path $taskToolRoot 'Plus-ins/PSD2UI-CEP'
    $taskUnsigned = Join-Path $taskWork 'unsigned'
    [IO.Directory]::CreateDirectory($taskUnsigned) | Out-Null
    # Ship compiled runtime only. No source tree, private keys, SDKs or Node install.
    foreach ($taskName in @('CSXS', 'host', 'index.html', 'panel.js', 'style.css', 'THIRD-PARTY-LICENSES.txt')) {
        $taskSource = Join-Path $taskPanelRoot $taskName
        if (-not (Test-Path -LiteralPath $taskSource)) { throw "CEP build output is missing: $taskSource" }
        Assert-TaskNoLinks $taskSource
        Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskUnsigned $taskName) -Recurse
    }
    Assert-TaskNoLinks $taskUnsigned
    $taskManifest = New-Object Xml.XmlDocument
    $taskManifest.XmlResolver = $null
    $taskManifest.Load((Join-Path $taskUnsigned 'CSXS/manifest.xml'))
    if ($taskManifest.DocumentElement.GetAttribute('ExtensionBundleId') -ne $taskExtensionId) { throw 'Unexpected extension ID.' }
    $taskVersion = $taskManifest.DocumentElement.GetAttribute('ExtensionBundleVersion')
    if ($taskVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'A three-segment extension version is required.' }
    $taskNameBase = 'PSD2UI-CEP-' + $taskVersion + '-Windows'
    $taskZxp = Join-Path $taskWork ($taskNameBase + '.zxp')
    Invoke-TaskSigning @('-sign', $taskUnsigned, $taskZxp, $CertificatePath, $taskPlainPassword) | Out-Null
    $taskSignature = Invoke-TaskSigning @('-verify', $taskZxp, '-certInfo', '-skipOnlineRevocationChecks')

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $taskInstallRoot = Join-Path $taskWork 'install'
    $taskSigned = Join-Path $taskInstallRoot $taskExtensionId
    [IO.Directory]::CreateDirectory($taskInstallRoot) | Out-Null
    [IO.Compression.ZipFile]::ExtractToDirectory($taskZxp, $taskSigned)
    if (-not (Test-Path -LiteralPath (Join-Path $taskSigned 'META-INF/signatures.xml'))) { throw 'ZXP signature payload is missing.' }
    $taskDeployedSignature = Invoke-TaskSigning @('-verify', $taskSigned, '-certInfo', '-skipOnlineRevocationChecks')
    foreach ($taskTemplate in @('Install.ps1', 'Install.cmd', 'README.md')) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot ('cep-install/' + $taskTemplate)) -Destination (Join-Path $taskInstallRoot $taskTemplate)
    }
    $taskEntries = @(Get-ChildItem -LiteralPath $taskSigned -File -Recurse -Force | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($taskSigned.Length + 1).Replace('\', '/'); sha256 = (Get-TaskSha256 $_.FullName).ToLowerInvariant() }
    })
    Write-TaskUtf8 (Join-Path $taskInstallRoot 'package-files.json') ([ordered]@{ format = 1; extensionId = $taskExtensionId; version = $taskVersion; files = $taskEntries } | ConvertTo-Json -Depth 6)
    Write-TaskUtf8 (Join-Path $taskInstallRoot 'SIGNATURE.txt') (
        "Windows ZXPSignCmd 4.1.3 verification. No timestamp was requested.`r`nCertificate expires; re-sign before expiry.`r`n`r`nZXP:`r`n" +
        ($taskSignature -join "`r`n") + "`r`n`r`nDeployed folder:`r`n" + ($taskDeployedSignature -join "`r`n"))
    & (Join-Path $taskInstallRoot 'Install.ps1') -DestinationRoot (Join-Path $taskWork 'check-destination') -ValidateOnly | Out-Null
    $taskZip = Join-Path $taskWork ($taskNameBase + '-Install-r' + $taskInstallerRevision + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($taskInstallRoot, $taskZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $taskZipCheck = Join-Path $taskWork 'zip-check'
    [IO.Compression.ZipFile]::ExtractToDirectory($taskZip, $taskZipCheck)
    Invoke-TaskSigning @('-verify', (Join-Path $taskZipCheck $taskExtensionId), '-skipOnlineRevocationChecks') | Out-Null
    & (Join-Path $taskZipCheck 'Install.ps1') -DestinationRoot (Join-Path $taskWork 'check-destination') -ValidateOnly | Out-Null
    $taskOutputZxp = Join-Path $taskOutputRoot ($taskNameBase + '-r' + $taskInstallerRevision + '.zxp')
    $taskOutputZip = Join-Path $taskOutputRoot ($taskNameBase + '-Install-r' + $taskInstallerRevision + '.zip')
    Copy-Item -LiteralPath $taskZxp -Destination $taskOutputZxp -Force
    Copy-Item -LiteralPath $taskZip -Destination $taskOutputZip -Force
    $taskReport = [ordered]@{ extensionId = $taskExtensionId; version = $taskVersion; installerRevision = $taskInstallerRevision; createdAtUtc = [DateTime]::UtcNow.ToString('o');
        signingTool = $taskToolUrl; timestamped = $false; signatureVerified = $true;
        zip = $taskOutputZip; zxp = $taskOutputZxp; zipSha256 = (Get-TaskSha256 $taskOutputZip);
        zxpSha256 = (Get-TaskSha256 $taskOutputZxp); runtimeFiles = $taskEntries.Count }
    Write-TaskUtf8 (Join-Path $taskOutputRoot ($taskNameBase + '-package-r' + $taskInstallerRevision + '.json')) ($taskReport | ConvertTo-Json -Depth 6)
    $taskReport | ConvertTo-Json -Depth 6
} finally {
    if ($taskPasswordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPasswordPointer) }
    $taskPlainPassword = $null
    if (Test-Path -LiteralPath $taskWork) {
        $null = Assert-TaskChild $taskWork $taskStagingRoot
        Assert-TaskNoLinks $taskWork
        Remove-Item -LiteralPath $taskWork -Recurse -Force
    }
}
