[CmdletBinding()]
param(
    [ValidateSet('Status', 'Inspect', 'Initialize', 'Preflight', 'Export', 'InitializeAndExport')]
    [string]$Operation = 'Status',

    [string]$DocumentPath,

    [string]$Module,

    [string]$Submodule,

    [string]$Name,

    [string]$RootLayerId,

    [switch]$WrapTopLevel,

    [string]$RootGroupName,

    [string]$UiResPath,

    [switch]$AllowReinitialize,

    [switch]$PrepareMcp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$mcpToolScript = Join-Path $scriptDirectory 'Invoke-Psd2UiMcpTool.ps1'
$script:prepareMcpOnNextCall = [bool]$PrepareMcp

function Invoke-McpTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName,

        [hashtable]$Payload = @{}
    )

    $payloadJson = $Payload | ConvertTo-Json -Depth 100 -Compress
    $prepareThisCall = $script:prepareMcpOnNextCall
    $script:prepareMcpOnNextCall = $false
    $output = & $mcpToolScript `
        -ToolName $ToolName `
        -PayloadJson $payloadJson `
        -PrepareMcp:$prepareThisCall
    if ($null -eq $output) { throw "PS-MCP 工具 $ToolName 没有返回结果。" }
    return ($output | Out-String | ConvertFrom-Json -Depth 100)
}

if ($Operation -eq 'Status') {
    Invoke-McpTool -ToolName 'psd2ui_photoshop_status' | ConvertTo-Json -Depth 100
    return
}

if ([string]::IsNullOrWhiteSpace($DocumentPath)) {
    throw "$Operation 操作必须提供 -DocumentPath。"
}
$resolvedDocumentPath = [IO.Path]::GetFullPath($DocumentPath)
if (-not (Test-Path -LiteralPath $resolvedDocumentPath -PathType Leaf)) {
    throw "目标 PSD 不存在：$resolvedDocumentPath"
}

$openResult = Invoke-McpTool -ToolName 'psd2ui_open_document' -Payload @{
    documentPath = $resolvedDocumentPath
}
$inspection = Invoke-McpTool -ToolName 'psd2ui_inspect_document' -Payload @{
    expectedDocumentPath = $resolvedDocumentPath
}

if ($Operation -eq 'Inspect') {
    [ordered]@{
        Status = 'inspected'
        Open = $openResult
        Inspection = $inspection
    } | ConvertTo-Json -Depth 100
    return
}

if ($Operation -eq 'Preflight') {
    $preflightOnly = Invoke-McpTool -ToolName 'psd2ui_preflight_export' -Payload @{
        expectedDocumentPath = $resolvedDocumentPath
    }
    [ordered]@{
        Status = 'ready'
        Inspection = $inspection
        Preflight = $preflightOnly
    } | ConvertTo-Json -Depth 100
    return
}

$resolvedUiResPath = $null
if ($Operation -eq 'Export' -or $Operation -eq 'InitializeAndExport') {
    $requestedUiResPath = if ([string]::IsNullOrWhiteSpace($UiResPath)) {
        [Environment]::GetEnvironmentVariable('PSD2UI_UIRES_PATH')
    } else {
        $UiResPath
    }
    if ([string]::IsNullOrWhiteSpace($requestedUiResPath)) {
        throw "$Operation 操作必须显式提供 -UiResPath，或配置 PSD2UI_UIRES_PATH。"
    }
    $resolvedUiResPath = [IO.Path]::GetFullPath($requestedUiResPath)
    if (-not (Test-Path -LiteralPath $resolvedUiResPath -PathType Container)) {
        throw "UIRes 目录不存在：$resolvedUiResPath"
    }
}

if ($Operation -eq 'Export') {
    $exportOnly = Invoke-McpTool -ToolName 'psd2ui_export_bundle' -Payload @{
        expectedDocumentPath = $resolvedDocumentPath
        uiResPath = $resolvedUiResPath
    }
    [ordered]@{
        Status = 'exported'
        Inspection = $inspection
        Export = $exportOnly
    } | ConvertTo-Json -Depth 100
    return
}

if ([string]::IsNullOrWhiteSpace($Module)) {
    throw "$Operation 操作必须提供 -Module。"
}
if ([string]::IsNullOrWhiteSpace($Name)) {
    $Name = [IO.Path]::GetFileNameWithoutExtension($resolvedDocumentPath)
}
if ([string]::IsNullOrWhiteSpace($RootGroupName)) {
    $RootGroupName = $Name
}

$topLevelLayers = @($inspection.topLevelLayers)
$rootResult = $null
$resolvedRootLayerId = $RootLayerId
if ([string]::IsNullOrWhiteSpace($resolvedRootLayerId)) {
    if ($topLevelLayers.Count -eq 1 -and [string]($topLevelLayers[0].kind) -match 'group') {
        $resolvedRootLayerId = [string]($topLevelLayers[0].id)
    } elseif ($WrapTopLevel) {
        $rootResult = Invoke-McpTool -ToolName 'psd2ui_wrap_document_root' -Payload @{
            expectedDocumentPath = $resolvedDocumentPath
            layerIds = @($topLevelLayers | ForEach-Object { [string]$_.id })
            groupName = $RootGroupName
        }
        $resolvedRootLayerId = [string]($rootResult.id)
    } else {
        $summary = ($topLevelLayers | ForEach-Object { "$($_.id):$($_.name)" }) -join ', '
        $message = '当前 PSD 不能自动确定单一文档根组。' `
            + "顶层图层：${summary}。请显式提供 -RootLayerId，或确认后增加 -WrapTopLevel。"
        throw $message
    }
}

$initializationPayload = @{
    expectedDocumentPath = $resolvedDocumentPath
    rootLayerId = $resolvedRootLayerId
    module = $Module
    name = $Name
    allowReinitialize = [bool]$AllowReinitialize
}
if (-not [string]::IsNullOrWhiteSpace($Submodule)) {
    $initializationPayload.submodule = $Submodule
}
$initialization = Invoke-McpTool -ToolName 'psd2ui_initialize_document' -Payload $initializationPayload

$preflight = $null
$export = $null
if ($Operation -eq 'InitializeAndExport') {
    $preflight = Invoke-McpTool -ToolName 'psd2ui_preflight_export' -Payload @{
        expectedDocumentPath = $resolvedDocumentPath
    }
    $export = Invoke-McpTool -ToolName 'psd2ui_export_bundle' -Payload @{
        expectedDocumentPath = $resolvedDocumentPath
        uiResPath = $resolvedUiResPath
    }
}

[ordered]@{
    Status = if ($Operation -eq 'InitializeAndExport') { 'exported' } else { 'initialized' }
    DocumentPath = $resolvedDocumentPath
    Root = if ($null -ne $rootResult) { $rootResult } else { @{ id = $resolvedRootLayerId } }
    Initialization = $initialization
    Preflight = $preflight
    Export = $export
} | ConvertTo-Json -Depth 100
