#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PackageZip)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskTestsRoot = Join-Path $taskRoot '.tmp/cep-install-tests'
$taskWork = Join-Path $taskTestsRoot ([Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskWork) | Out-Null
$script:MockPhotoshopRunning = $false
$script:FailPromotion = $false
$script:PromotionLockMode = ''
$script:PromotionLock = $null
$script:PromotionTimer = $null
$taskChecks = 0

function Assert-Test([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "TEST FAILED: $Message" }
    $script:taskChecks += 1
}
function Assert-Throws([scriptblock]$Action, [string]$Expected) {
    $caught = $null
    try { & $Action | Out-Null } catch { $caught = $_.Exception.Message }
    Assert-Test ([bool]($caught -and $caught.Contains($Expected))) ('Expected error: ' + $Expected + '; actual: ' + $caught)
}
# Scope-local mocks only: no real Photoshop process or global command is changed.
function Get-Process {
    [CmdletBinding()]param([string]$Name)
    if ($script:MockPhotoshopRunning) { return [pscustomobject]@{ ProcessName = 'Photoshop' } }
    return @()
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $taskPackage = Join-Path $taskWork 'package'
    [IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($PackageZip), $taskPackage)
    . (Join-Path $taskPackage 'Install.ps1') -LibraryOnly
    $script:Psd2UiInstallLog = Join-Path $taskWork 'installer.log'
    Add-Type -TypeDefinition @'
using System;
using System.Threading;
public static class Psd2UiInstallTestLock {
    public static Timer ReleaseLater(IDisposable handle) {
        return new Timer(state => ((IDisposable)state).Dispose(), handle, 400, Timeout.Infinite);
    }
}
'@
    function Move-Psd2UiDirectoryOnce([string]$Source, [string]$Destination) {
        if ($Source.Contains('.staging-')) {
            if ($script:FailPromotion) {
                $script:FailPromotion = $false
                throw 'Injected failure during staged extension promotion'
            }
            if ($script:PromotionLockMode) {
                $script:PromotionLock = [IO.File]::Open((Join-Path $Source 'panel.js'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
                if ($script:PromotionLockMode -eq 'temporary') {
                    $script:PromotionTimer = [Psd2UiInstallTestLock]::ReleaseLater($script:PromotionLock)
                }
                $script:PromotionLockMode = ''
            }
        }
        [IO.Directory]::Move($Source, $Destination)
    }
    $taskTargetRoot = Join-Path $taskWork 'Adobe/CEP/extensions'
    $taskStageRoot = Join-Path $taskWork 'Adobe/CEP/psd2ui-staging'
    $taskSource = Join-Path $taskPackage 'com.yoyoengine.psd2ui.cep'
    $taskTarget = Join-Path $taskTargetRoot 'com.yoyoengine.psd2ui.cep'
    $taskInventoryPath = Join-Path $taskPackage 'package-files.json'
    $taskInventoryBytes = [IO.File]::ReadAllBytes($taskInventoryPath)
    $taskInventory = Get-Content -LiteralPath $taskInventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json

    $taskCheck = Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot -CheckOnly
    Assert-Test ($taskCheck.Valid -and -not $taskCheck.Changed) 'CheckOnly returns a read-only result'
    Assert-Test (-not (Test-Path -LiteralPath $taskTargetRoot)) 'CheckOnly must not create the destination'
    $taskOther = Join-Path $taskTargetRoot 'unrelated-extension'
    [IO.Directory]::CreateDirectory($taskOther) | Out-Null
    [IO.File]::WriteAllText((Join-Path $taskOther 'keep.txt'), 'keep unrelated extension')

    $taskInstalled = Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot
    Assert-Test ($taskInstalled.Changed -and -not $taskInstalled.Backup) 'First installation succeeds without backup'
    Assert-Psd2UiInventory $taskTarget $taskInventory
    Assert-Test (Test-Path -LiteralPath (Join-Path $taskTarget 'META-INF/signatures.xml')) 'Installed signature is retained'
    $taskUpdated = Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot
    Assert-Test ($taskUpdated.Backup -and (Test-Path -LiteralPath $taskUpdated.Backup)) 'Update retains the previous extension'
    Assert-Psd2UiInventory $taskUpdated.Backup $taskInventory

    $script:FailPromotion = $true
    Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } 'The previous extension was restored'
    Assert-Psd2UiInventory $taskTarget $taskInventory
    Assert-Test (@(Get-ChildItem -LiteralPath $taskStageRoot -Force).Count -eq 0) 'Failed installation removes only its staging directory outside extensions'

    $script:PromotionLockMode = 'temporary'
    try {
        $taskRetried = Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot
        Assert-Test $taskRetried.Changed 'A real temporary file handle is released and promotion succeeds'
        Assert-Psd2UiInventory $taskTarget $taskInventory
        Assert-Test ((Get-Content -LiteralPath $script:Psd2UiInstallLog -Raw).Contains('Rename attempt 2:')) 'Directory lock retries are logged'
    } finally { if ($script:PromotionTimer) { $script:PromotionTimer.Dispose() }; if ($script:PromotionLock) { $script:PromotionLock.Dispose() } }

    $script:PromotionLockMode = 'persistent'
    try {
        Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot -WarningAction SilentlyContinue } "Installation failed during 'promote staged extension'. The previous extension was restored."
        Assert-Psd2UiInventory $taskTarget $taskInventory
        Assert-Test ((Get-Content -LiteralPath $script:Psd2UiInstallLog -Raw).Contains('Staging cleanup failed; retained:')) 'Cleanup failure is logged without replacing the original promotion error'
        Assert-Test (@(Get-ChildItem -LiteralPath $taskStageRoot -Force).Count -eq 1) 'Locked staging remains outside Photoshop extension discovery'
    } finally {
        if ($script:PromotionLock) { $script:PromotionLock.Dispose() }
        foreach ($taskRemaining in Get-ChildItem -LiteralPath $taskStageRoot -Force) {
            $taskSafe = Assert-Psd2UiInside $taskRemaining.FullName $taskStageRoot
            Assert-Psd2UiNoLinks $taskSafe -Recurse
            Remove-Item -LiteralPath $taskSafe -Recurse -Force
        }
    }

    $taskExistingLock = [IO.File]::Open((Join-Path $taskTarget 'panel.js'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } "Installation failed during 'back up existing extension'. The existing extension was not replaced."
    } finally { $taskExistingLock.Dispose() }
    Assert-Psd2UiInventory $taskTarget $taskInventory

    $taskRenameSource = Join-Path $taskWork 'rename-source'
    $taskRenameTarget = Join-Path $taskWork 'rename-existing'
    [IO.Directory]::CreateDirectory($taskRenameSource) | Out-Null
    [IO.Directory]::CreateDirectory($taskRenameTarget) | Out-Null
    Assert-Throws { Move-Psd2UiDirectory $taskRenameSource $taskRenameTarget } 'Rename destination already exists'
    Assert-Test (Test-Path -LiteralPath $taskRenameSource) 'Existing destination is not silently used as a parent directory'

    $taskPanel = Join-Path $taskSource 'panel.js'
    $taskOriginalPanel = [IO.File]::ReadAllBytes($taskPanel)
    try {
        [IO.File]::AppendAllText($taskPanel, 'corrupted')
        Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } 'changed or is corrupt'
    } finally { [IO.File]::WriteAllBytes($taskPanel, $taskOriginalPanel) }
    Assert-Psd2UiInventory $taskTarget $taskInventory

    try {
        $taskBadInventory = Get-Content -LiteralPath $taskInventoryPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $taskBadInventory.files[0].path = '../escape.txt'
        [IO.File]::WriteAllText($taskInventoryPath, ($taskBadInventory | ConvertTo-Json -Depth 6))
        Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } 'unsafe path'
    } finally { [IO.File]::WriteAllBytes($taskInventoryPath, $taskInventoryBytes) }

    $taskExtra = Join-Path $taskSource 'unexpected.txt'
    try {
        [IO.File]::WriteAllText($taskExtra, 'unexpected')
        Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } 'outside the release inventory'
    } finally { Remove-Item -LiteralPath $taskExtra -Force }

    $script:MockPhotoshopRunning = $true
    Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot } 'Close Photoshop'
    $null = Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskTargetRoot -CheckOnly
    $script:MockPhotoshopRunning = $false

    $taskForeignRoot = Join-Path $taskWork 'foreign/extensions'
    $taskForeign = Join-Path $taskForeignRoot 'com.yoyoengine.psd2ui.cep'
    [IO.Directory]::CreateDirectory((Join-Path $taskForeign 'CSXS')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $taskForeign 'CSXS/manifest.xml'), '<ExtensionManifest ExtensionBundleId="different.product"/>')
    Assert-Throws { Install-Psd2UiCep -PackageRoot $taskPackage -TargetRoot $taskForeignRoot } 'unrelated extension'
    Assert-Test (Test-Path -LiteralPath (Join-Path $taskOther 'keep.txt')) 'Unrelated extensions remain intact'
    Assert-Psd2UiInventory $taskTarget $taskInventory
    Write-Output ("Windows PowerShell $($PSVersionTable.PSVersion) install checks passed: $taskChecks; install/update/rollback/integrity/path/identity/process isolation/real file locks/error logging.")
} finally {
    $taskFull = [IO.Path]::GetFullPath($taskWork)
    if (-not $taskFull.StartsWith([IO.Path]::GetFullPath($taskTestsRoot) + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe test cleanup path.' }
    if (Test-Path -LiteralPath $taskFull) { Remove-Item -LiteralPath $taskFull -Recurse -Force }
}
