[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$DocumentPath,

    [Parameter(Mandatory = $true)]
    [string]$PlanPath,

    [string]$AuthoringRoot,

    [switch]$PrepareMcp
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
    throw "submodule 迁移计划不存在：$resolvedPlanPath"
}

try {
    $migrationPlan = Get-Content -LiteralPath $resolvedPlanPath -Raw -Encoding UTF8 | ConvertFrom-Json -Depth 100
} catch {
    throw "submodule 迁移计划不是有效 JSON：$($_.Exception.Message)"
}
if ($migrationPlan.version -ne 1 -or [string]::IsNullOrWhiteSpace([string]$migrationPlan.confirmationId)) {
    throw 'submodule 迁移计划必须使用 version=1 并提供 confirmationId。'
}

$selected = $null
foreach ($entry in @($migrationPlan.documents)) {
    $candidateValue = if (-not [string]::IsNullOrWhiteSpace([string]$entry.documentPath)) {
        [string]$entry.documentPath
    } else {
        [string]$entry.documentRelativePath
    }
    if ([string]::IsNullOrWhiteSpace($candidateValue)) {
        throw 'submodule 迁移计划中的每个文档必须提供 documentPath 或 documentRelativePath。'
    }
    if ([IO.Path]::IsPathRooted($candidateValue)) {
        $candidate = [IO.Path]::GetFullPath($candidateValue)
    } else {
        if ($resolvedAuthoringRoots.Count -ne 1) {
            throw '使用 documentRelativePath 时必须只配置一个 AuthoringRoot。'
        }
        $candidate = [IO.Path]::GetFullPath((Join-Path $resolvedAuthoringRoots[0] $candidateValue))
    }
    if ($candidate.Equals($resolvedDocumentPath, [StringComparison]::OrdinalIgnoreCase)) {
        if ($null -ne $selected) {
            throw "submodule 迁移计划重复声明目标 PSD：$resolvedDocumentPath"
        }
        $selected = $entry
    }
}
if ($null -eq $selected) {
    throw "submodule 迁移计划未声明目标 PSD：$resolvedDocumentPath"
}

$documentPlan = [ordered]@{
    version = 1
    confirmationId = [string]$migrationPlan.confirmationId
    submodule = [string]$selected.submodule
    expected = $selected.expected
}
$payload = @{
    expectedDocumentPath = $resolvedDocumentPath
    confirmationId = [string]$migrationPlan.confirmationId
    confirmationText = 'APPLY_CONFIRMED_SUBMODULE_MIGRATION'
    plan = $documentPlan
} | ConvertTo-Json -Depth 100 -Compress

$mcpTool = Join-Path $scriptDirectory 'Invoke-Psd2UiMcpTool.ps1'
$openPayload = @{
    documentPath = $resolvedDocumentPath
} | ConvertTo-Json -Depth 10 -Compress
$null = & $mcpTool `
    -ToolName 'psd2ui_open_document' `
    -PayloadJson $openPayload `
    -PrepareMcp:$PrepareMcp
if ($LASTEXITCODE -ne 0) {
    throw "打开目标 PSD 失败（exit=$LASTEXITCODE）。"
}

& $mcpTool `
    -ToolName 'psd2ui_apply_confirmed_submodule_migration' `
    -PayloadJson $payload `
    -Maintenance `
    -PrepareMcp:$false
if ($LASTEXITCODE -ne 0) {
    throw "应用 PSD2UI submodule 迁移失败（exit=$LASTEXITCODE）。"
}
