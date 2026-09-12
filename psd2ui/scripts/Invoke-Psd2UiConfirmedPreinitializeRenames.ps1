[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DocumentPath,

    [Parameter(Mandatory = $true)]
    [string]$PlanPath,

    [Parameter(Mandatory = $true)]
    [string]$RootLayerId,

    [string]$AuthoringRoot,

    [switch]$PrepareMcp,

    [switch]$RepairPreservedState
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$resolvedDocumentPath = [IO.Path]::GetFullPath($DocumentPath)
$resolvedPlanPath = [IO.Path]::GetFullPath($PlanPath)

$configuredRoots = if (-not [string]::IsNullOrWhiteSpace($AuthoringRoot)) {
    @($AuthoringRoot)
} else {
    @(([Environment]::GetEnvironmentVariable('PSD2UI_AUTHORING_ROOTS') -split [IO.Path]::PathSeparator) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
if ($configuredRoots.Count -eq 0) {
    throw '必须显式提供 -AuthoringRoot，或配置 PSD2UI_AUTHORING_ROOTS。'
}
$resolvedAuthoringRoots = @($configuredRoots | ForEach-Object { [IO.Path]::GetFullPath($_) })
$isAuthorized = $false
foreach ($root in $resolvedAuthoringRoots) {
    if ($resolvedDocumentPath.StartsWith(
            $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) {
        $isAuthorized = $true
        break
    }
}
if (-not $isAuthorized) {
    throw "PSD 必须位于已配置的创作目录：$($resolvedAuthoringRoots -join '; ')"
}
$env:PSD2UI_AUTHORING_ROOTS = $resolvedAuthoringRoots -join [IO.Path]::PathSeparator
if ([IO.Path]::GetExtension($resolvedDocumentPath) -ne '.psd') {
    throw "目标文档必须是 PSD：$resolvedDocumentPath"
}
if (-not (Test-Path -LiteralPath $resolvedPlanPath -PathType Leaf)) {
    throw "结构计划不存在：$resolvedPlanPath"
}
if ([string]::IsNullOrWhiteSpace($RootLayerId)) {
    throw '初始化前重命名必须提供 RootLayerId。'
}

try {
    $plan = Get-Content -LiteralPath $resolvedPlanPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
} catch {
    throw "结构计划不是有效 JSON：$($_.Exception.Message)"
}
if ($plan.version -ne 1 -or [string]::IsNullOrWhiteSpace([string]$plan.confirmationId)) {
    throw '结构计划必须使用 version=1 并提供 confirmationId。'
}

$payload = @{
    expectedDocumentPath = $resolvedDocumentPath
    rootLayerId = $RootLayerId
    confirmationId = [string]$plan.confirmationId
    confirmationText = 'APPLY_CONFIRMED_PREINITIALIZE_RENAMES'
    repairPreservedState = [bool]$RepairPreservedState
    plan = $plan
} | ConvertTo-Json -Depth 100 -Compress

$mcpTool = Join-Path $scriptDirectory 'Invoke-Psd2UiMcpTool.ps1'
& $mcpTool `
    -ToolName 'psd2ui_apply_confirmed_preinitialize_renames' `
    -PayloadJson $payload `
    -Maintenance `
    -PrepareMcp:$PrepareMcp
if ($LASTEXITCODE -ne 0) {
    throw "应用 PSD2UI 初始化前命名失败（exit=$LASTEXITCODE）。"
}
