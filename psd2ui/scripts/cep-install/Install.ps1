#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$DestinationRoot = '',
    [string]$LogPath = '',
    [switch]$ValidateOnly,
    [switch]$LibraryOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Psd2UiExtensionId = 'com.yoyoengine.psd2ui.cep'
$script:Psd2UiInstallLog = $null

function Write-Psd2UiInstallLog([string]$Message, $Record = $null) {
    $line = (Get-Date -Format o) + ' ' + $Message
    if ($Record) {
        $line += [Environment]::NewLine + $Record.Exception.ToString()
        $line += [Environment]::NewLine + 'ErrorId: ' + $Record.FullyQualifiedErrorId
        $line += [Environment]::NewLine + 'At: ' + $Record.InvocationInfo.PositionMessage
        $line += [Environment]::NewLine + 'Stack: ' + $Record.ScriptStackTrace
    }
    if ($script:Psd2UiInstallLog) {
        try { [IO.File]::AppendAllText($script:Psd2UiInstallLog, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false))) }
        catch { Write-Warning ('Cannot append installer log: ' + $_.Exception.Message) }
    }
    Write-Verbose $line
}

function Move-Psd2UiDirectoryOnce([string]$Source, [string]$Destination) {
    # Exact rename: unlike Move-Item, an existing destination is never treated as
    # a parent into which the source directory can silently be nested.
    [IO.Directory]::Move($Source, $Destination)
}

function Move-Psd2UiDirectory([string]$Source, [string]$Destination) {
    $delays = @(250, 500, 1000, 1500)
    for ($attempt = 0; ; $attempt++) {
        if (Test-Path -LiteralPath $Destination) { throw "Rename destination already exists: $Destination" }
        Assert-Psd2UiNoLinks $Source -Recurse
        Assert-Psd2UiNoLinks ([IO.Path]::GetDirectoryName($Destination))
        try {
            Write-Psd2UiInstallLog "Rename attempt $($attempt + 1): $Source -> $Destination"
            Move-Psd2UiDirectoryOnce $Source $Destination
            return
        } catch {
            $native = $_.Exception
            while ($native.InnerException) { $native = $native.InnerException }
            $code = $native.HResult -band 0xffff
            Write-Psd2UiInstallLog "Rename failed, native code $code" $_
            # A file reader without FILE_SHARE_DELETE can make a directory
            # rename report AccessDenied even when its ACL permits modification.
            # Bound the wait; do not change permissions or retry other failures.
            if ($code -notin @(5, 32, 33) -or $attempt -ge $delays.Count -or
                -not (Test-Path -LiteralPath $Source) -or (Test-Path -LiteralPath $Destination)) { throw }
            Start-Sleep -Milliseconds $delays[$attempt]
        }
    }
}

function Get-Psd2UiSha256([string]$File) {
    # Avoid module discovery when PS 5.1 inherits PowerShell 7's PSModulePath.
    $stream = [IO.File]::OpenRead($File)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Get-Psd2UiFullPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw 'An explicit local path is required.' }
    $full = [IO.Path]::GetFullPath($Value)
    if ($full.Length -gt [IO.Path]::GetPathRoot($full).Length) { return $full.TrimEnd([char[]]'\/') }
    return $full
}

function Assert-Psd2UiInside([string]$Candidate, [string]$Root) {
    $candidateFull = Get-Psd2UiFullPath $Candidate
    $rootFull = Get-Psd2UiFullPath $Root
    if (-not $candidateFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path is outside the allowed directory: $candidateFull"
    }
    return $candidateFull
}

function Assert-Psd2UiNoLinks([string]$Target, [switch]$Recurse) {
    $current = Get-Psd2UiFullPath $Target
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Symbolic links and junctions are not accepted: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
    if ($Recurse -and (Test-Path -LiteralPath $Target)) {
        foreach ($item in Get-ChildItem -LiteralPath $Target -Recurse -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Symbolic links and junctions are not accepted: $($item.FullName)"
            }
        }
    }
}

function Assert-Psd2UiExtension([string]$Directory) {
    Assert-Psd2UiNoLinks $Directory -Recurse
    $manifestPath = Assert-Psd2UiInside (Join-Path $Directory 'CSXS/manifest.xml') $Directory
    $settings = New-Object Xml.XmlReaderSettings
    $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [Xml.XmlReader]::Create($manifestPath, $settings)
    try {
        $manifest = New-Object Xml.XmlDocument
        $manifest.XmlResolver = $null
        $manifest.Load($reader)
    } finally { $reader.Dispose() }
    if ($manifest.DocumentElement.GetAttribute('ExtensionBundleId') -ne $script:Psd2UiExtensionId) {
        throw "Refusing to replace an unrelated extension: $Directory"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Directory 'META-INF/signatures.xml') -PathType Leaf)) {
        throw 'The signed META-INF/signatures.xml file is missing. Obtain a complete release ZIP.'
    }
}

function Assert-Psd2UiInventory([string]$Directory, $Inventory) {
    Assert-Psd2UiExtension $Directory
    if ($Inventory.extensionId -ne $script:Psd2UiExtensionId -or $Inventory.format -ne 1) {
        throw 'The package file inventory belongs to a different product or format.'
    }
    $expected = @{}
    foreach ($entry in @($Inventory.files)) {
        if (-not $entry.path -or [IO.Path]::IsPathRooted($entry.path) -or $entry.path -match '(^|[\/])\.\.([\/]|$)' -or $entry.path.Contains(':')) {
            throw 'The package file inventory contains an unsafe path.'
        }
        $file = Assert-Psd2UiInside (Join-Path $Directory $entry.path) $Directory
        if ($expected.ContainsKey($file)) { throw 'The package file inventory contains duplicate paths.' }
        $expected[$file] = $true
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Package file is missing: $($entry.path)" }
        if ((Get-Psd2UiSha256 $file) -ne $entry.sha256) {
            throw "Package file changed or is corrupt: $($entry.path)"
        }
    }
    $actualFiles = @(Get-ChildItem -LiteralPath $Directory -File -Recurse -Force)
    if ($actualFiles.Count -ne $expected.Count) { throw 'The extension contains files outside the release inventory.' }
    foreach ($item in $actualFiles) {
        if (-not $expected.ContainsKey((Get-Psd2UiFullPath $item.FullName))) { throw "Unexpected package file: $($item.FullName)" }
    }
}

function Install-Psd2UiCep {
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$PackageRoot, [string]$TargetRoot = '', [switch]$CheckOnly)

    if (-not $TargetRoot) {
        $roaming = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
        if (-not $roaming) { throw 'Windows roaming AppData could not be located.' }
        $TargetRoot = Join-Path $roaming 'Adobe/CEP/extensions'
    }
    $packageFull = Get-Psd2UiFullPath $PackageRoot
    $rootFull = Get-Psd2UiFullPath $TargetRoot
    $source = Assert-Psd2UiInside (Join-Path $packageFull $script:Psd2UiExtensionId) $packageFull
    $target = Assert-Psd2UiInside (Join-Path $rootFull $script:Psd2UiExtensionId) $rootFull
    Assert-Psd2UiNoLinks $packageFull
    Assert-Psd2UiNoLinks $rootFull
    if ($source -eq $target -or $source.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $rootFull.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The unpacked installation source must be separate from the CEP destination.'
    }
    $inventory = Get-Content -LiteralPath (Join-Path $packageFull 'package-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert-Psd2UiInventory $source $inventory
    if (Test-Path -LiteralPath $target) { Assert-Psd2UiExtension $target }
    if ($CheckOnly) { return [pscustomobject]@{ Valid = $true; Target = $target; Changed = $false } }
    if (Get-Process -Name Photoshop -ErrorAction SilentlyContinue) {
        throw 'Close Photoshop, then run Install.cmd again. No Photoshop process will be stopped automatically.'
    }

    $cepRoot = [IO.Path]::GetDirectoryName($rootFull)
    $backupRoot = Join-Path $cepRoot 'psd2ui-backups'
    $stageRoot = Join-Path $cepRoot 'psd2ui-staging'
    Assert-Psd2UiNoLinks $backupRoot
    Assert-Psd2UiNoLinks $stageRoot
    $suffix = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
    $stage = Assert-Psd2UiInside (Join-Path $stageRoot ($script:Psd2UiExtensionId + '.staging-' + $suffix)) $stageRoot
    $backup = Assert-Psd2UiInside (Join-Path $backupRoot ($script:Psd2UiExtensionId + '-' + $suffix)) $backupRoot
    $backedUp = $false
    $promoted = $false
    $phase = 'create installation directories'
    try {
        Write-Psd2UiInstallLog "Source: $source; Target: $target; Stage: $stage; Backup: $backup"
        [IO.Directory]::CreateDirectory($rootFull) | Out-Null
        [IO.Directory]::CreateDirectory($stageRoot) | Out-Null
        $phase = 'copy signed extension to staging'
        Write-Psd2UiInstallLog $phase
        Copy-Item -LiteralPath $source -Destination $stage -Recurse
        $phase = 'validate staged signed files'
        Write-Psd2UiInstallLog $phase
        Assert-Psd2UiInventory $stage $inventory
        if (Test-Path -LiteralPath $target) {
            $phase = 'back up existing extension'
            Write-Psd2UiInstallLog $phase
            [IO.Directory]::CreateDirectory($backupRoot) | Out-Null
            Assert-Psd2UiNoLinks $target -Recurse
            Move-Psd2UiDirectory $target $backup
            $backedUp = $true
        }
        $phase = 'promote staged extension'
        Write-Psd2UiInstallLog $phase
        Move-Psd2UiDirectory $stage $target
        $promoted = $true
        $phase = 'validate installed signed files'
        Write-Psd2UiInstallLog $phase
        Assert-Psd2UiInventory $target $inventory
        Write-Psd2UiInstallLog 'Installation succeeded.'
        return [pscustomobject]@{ Valid = $true; Target = $target; Changed = $true; Backup = $(if ($backedUp) { $backup } else { $null }) }
    } catch {
        $original = $_.Exception.Message
        Write-Psd2UiInstallLog "Installation failed during: $phase" $_
        $recovery = 'The existing extension was not replaced.'
        try {
            if ($promoted -and (Test-Path -LiteralPath $target)) {
                $null = Assert-Psd2UiInside $target $rootFull
                Assert-Psd2UiNoLinks $target -Recurse
                Remove-Item -LiteralPath $target -Recurse -Force
                $recovery = 'The failed new installation was removed.'
            }
            if ($backedUp) {
                $null = Assert-Psd2UiInside $backup $backupRoot
                Assert-Psd2UiNoLinks $backup -Recurse
                Move-Psd2UiDirectory $backup $target
                $recovery = 'The previous extension was restored.'
            }
        } catch {
            Write-Psd2UiInstallLog 'Automatic rollback failed.' $_
            throw "Installation failed during '$phase': $original. Automatic rollback failed: $($_.Exception.Message). Backup: $backup"
        }
        Write-Psd2UiInstallLog $recovery
        throw "Installation failed during '$phase'. $recovery $original"
    } finally {
        try {
            if (Test-Path -LiteralPath $stage) {
                $null = Assert-Psd2UiInside $stage $stageRoot
                Assert-Psd2UiNoLinks $stage -Recurse
                Remove-Item -LiteralPath $stage -Recurse -Force
            }
        } catch {
            # A locked staging file must not hide the actual installation or
            # rollback error (or turn an already successful install into failure).
            Write-Psd2UiInstallLog "Staging cleanup failed; retained: $stage" $_
            Write-Warning "Could not remove staging directory: $stage. See the installer log."
        }
    }
}

if (-not $LibraryOnly) {
    if (-not $ValidateOnly) {
        try {
            if (-not $LogPath) {
                $LogPath = Join-Path ([IO.Path]::GetTempPath()) ('PSD2UI-Install/install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N') + '.log')
            }
            $LogPath = Get-Psd2UiFullPath $LogPath
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($LogPath)) | Out-Null
            [IO.File]::WriteAllText($LogPath, '', (New-Object Text.UTF8Encoding($false)))
            $script:Psd2UiInstallLog = $LogPath
            $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
            $principal = New-Object Security.Principal.WindowsPrincipal($identity)
            Write-Psd2UiInstallLog ('Installer revision: 2; PowerShell: ' + $PSVersionTable.PSVersion + '; Account: ' + $identity.Name + '; Elevated: ' + $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
            Write-Psd2UiInstallLog "Package: $PSScriptRoot; Requested destination: $DestinationRoot"
        } catch { Write-Warning ('Cannot create installer log: ' + $_.Exception.Message) }
    }
    try {
        $result = Install-Psd2UiCep -PackageRoot $PSScriptRoot -TargetRoot $DestinationRoot -CheckOnly:$ValidateOnly
        Write-Output $result
        if (-not $ValidateOnly) { Write-Host 'Installed. Open Photoshop > Window > Extensions > PSD2UI.' }
    } catch {
        Write-Psd2UiInstallLog 'Installation command failed.' $_
        Write-Error $_ -ErrorAction Continue
        exit 1
    } finally {
        if ($script:Psd2UiInstallLog) { Write-Host "Installer log: $script:Psd2UiInstallLog" }
    }
}
