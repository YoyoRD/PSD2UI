#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'InstallDependencies', 'Connect', 'Check', 'Call')]
    [string]$Operation = 'Check',

    [string]$ToolName,

    [string]$PayloadJson = '{}',

    [string[]]$AuthoringRoot = @(),

    [string]$UiResPath,

    [string]$UdtRoot,

    [ValidateSet('cep', 'uxp')]
    [string]$HostTransport = 'cep',

    [string]$CepInstanceId,

    [ValidateRange(1, 65535)]
    [int]$UdtPort = 14001
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This file is copied unchanged into .cursor/tools/psd2ui/scripts.
$portableToolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$portableMcpRoot = Join-Path $portableToolRoot 'PS-MCP'
$portableClient = Join-Path $PSScriptRoot 'Invoke-Psd2UiMcpTool.ps1'

function Resolve-ExplicitPath([string]$Value, [string]$Name) {
    # .NET Framework (Windows PowerShell 5.1) has no IsPathFullyQualified.
    # IsPathRooted alone also accepts drive-relative and current-drive paths.
    if ([string]::IsNullOrWhiteSpace($Value) -or -not [IO.Path]::IsPathRooted($Value) -or
        $Value -match '^[A-Za-z]:(?![\\/])' -or
        ([IO.Path]::DirectorySeparatorChar -eq '\' -and $Value -match '^[\\/](?![\\/])')) {
        throw "$Name 必须显式提供绝对路径：$Value"
    }
    return [IO.Path]::GetFullPath($Value)
}

if ($Operation -eq 'Call') {
    if ([string]::IsNullOrWhiteSpace($ToolName)) {
        throw 'Call 必须提供 -ToolName。'
    }
    # The Node client validates the original JSON before connecting to MCP.
    # Do not parse/reserialize nested plans through a version-specific PS codec.
}

$portableAuthoringRoots = @(
    foreach ($portableRoot in $AuthoringRoot) {
        $portableResolvedRoot = Resolve-ExplicitPath $portableRoot 'AuthoringRoot'
        if ($portableResolvedRoot.Contains([IO.Path]::PathSeparator)) {
            throw "AuthoringRoot 不能含目录列表分隔符 $([IO.Path]::PathSeparator)：$portableRoot"
        }
        $portableResolvedRoot
    }
)
if ($UiResPath) { $UiResPath = Resolve-ExplicitPath $UiResPath 'UiResPath' }
if ($UdtRoot) { $UdtRoot = Resolve-ExplicitPath $UdtRoot 'UdtRoot' }

if (-not (Get-Command node -CommandType Application -ErrorAction SilentlyContinue)) {
    throw '未找到 Node.js；请先安装 Node.js 20.19.x、22.12 或更高受支持版本。'
}
# The locked MCP client imports jose 6 through CommonJS, which needs require(esm).
$portableNodeVersionText = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0) { throw '无法读取 Node.js 版本。' }
$portableNodeVersion = [version]($portableNodeVersionText.Trim())
$portableNodeSupported = (
    ($portableNodeVersion.Major -eq 20 -and $portableNodeVersion -ge [version]'20.19.0') -or
    ($portableNodeVersion.Major -eq 22 -and $portableNodeVersion -ge [version]'22.12.0') -or
    $portableNodeVersion.Major -ge 23
)
if (-not $portableNodeSupported) {
    throw "当前 Node.js $portableNodeVersion 不支持本包锁定依赖；需要 20.19.x、22.12+ 或 23+。"
}
if (-not (Test-Path -LiteralPath $portableClient -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $portableMcpRoot 'package-lock.json') -PathType Leaf)) {
    throw "PSD2UI 包不完整：$portableToolRoot"
}

# A transferred bundle must never inherit another repository's host or PSD defaults.
$portableSavedEnvironment = @{}
foreach ($portableEntry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    if ($portableEntry.Key -match '^(PSD2UI_|YOYO_PSD2UI_)') {
        $portableSavedEnvironment[$portableEntry.Key] = $portableEntry.Value
    }
}
try {
    foreach ($portableName in $portableSavedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($portableName, $null, 'Process')
    }
    $env:PSD2UI_TOOL_ROOT = $portableToolRoot
    $env:PSD2UI_HOST = $HostTransport
    if ($CepInstanceId) { $env:PSD2UI_CEP_INSTANCE_ID = $CepInstanceId }
    $env:PSD2UI_UDT_PORT = [string]$UdtPort
    if ($portableAuthoringRoots.Count -gt 0) {
        $env:PSD2UI_AUTHORING_ROOTS = $portableAuthoringRoots -join [IO.Path]::PathSeparator
    }
    if ($UiResPath) { $env:PSD2UI_UIRES_PATH = $UiResPath }
    if ($UdtRoot) { $env:PSD2UI_UDT_ROOT = $UdtRoot }

    $portableNeedsInstall = $Operation -eq 'InstallDependencies'
    if ($Operation -eq 'Prepare') {
        $portableRuntimeReport = & node (Join-Path $portableMcpRoot 'scripts/check-runtime.js')
        $portableNeedsInstall = $LASTEXITCODE -ne 0
        if ($portableNeedsInstall) { Write-Host $portableRuntimeReport }
    }
    if ($portableNeedsInstall) {
        if (-not (Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue)) {
            throw '未找到 npm.cmd；请修复本机 Node.js/npm 安装。'
        }
        Push-Location -LiteralPath $portableMcpRoot
        try {
            & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw '安装 PS-MCP 锁定依赖失败。' }
        } finally {
            Pop-Location
        }
        $portableRuntimeReport = & node (Join-Path $portableMcpRoot 'scripts/check-runtime.js')
        if ($LASTEXITCODE -ne 0) { throw '依赖恢复后仍无法加载 PS-MCP，请保留上述错误。' }
    }
    if ($Operation -in @('Prepare', 'InstallDependencies')) {
        [ordered]@{ operation = $Operation; toolRoot = $portableToolRoot; ready = $true; installed = $portableNeedsInstall; dependenciesInstalled = $portableNeedsInstall; photoshopChecked = $false } | ConvertTo-Json -Depth 10
        return
    }

    foreach ($portableDependency in @('@modelcontextprotocol/server', '@modelcontextprotocol/client')) {
        if (-not (Test-Path -LiteralPath (Join-Path $portableMcpRoot "node_modules/$portableDependency") -PathType Container)) {
            throw 'PS-MCP 依赖未安装完整；请手动执行本脚本 -Operation InstallDependencies，然后重新检查。'
        }
    }

    switch ($Operation) {
        'Check' {
            $env:PSD2UI_UDT_AUTOSTART = 'false'
            & $portableClient -ToolName 'psd2ui_photoshop_status' -PayloadJson '{"checkOnly":true}'
        }
        'Connect' {
            # CEP discovers the already open panel; explicit UXP may prepare UDT.
            & $portableClient -ToolName 'psd2ui_photoshop_status' -PayloadJson '{}'
        }
        'Call' {
            & $portableClient -ToolName $ToolName -PayloadJson $PayloadJson
        }
    }
} finally {
    foreach ($portableEntry in @([Environment]::GetEnvironmentVariables('Process').GetEnumerator())) {
        if ($portableEntry.Key -match '^(PSD2UI_|YOYO_PSD2UI_)') {
            [Environment]::SetEnvironmentVariable($portableEntry.Key, $null, 'Process')
        }
    }
    foreach ($portableEntry in $portableSavedEnvironment.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($portableEntry.Key, $portableEntry.Value, 'Process')
    }
}
