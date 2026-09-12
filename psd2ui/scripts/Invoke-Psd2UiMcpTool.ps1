[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ToolName,

    [string]$PayloadJson = '{}',

    [switch]$PrepareMcp,

    [switch]$Maintenance
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$psd2UiRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))
$mcpRoot = Join-Path $psd2UiRoot 'PS-MCP'
$clientScript = Join-Path $mcpRoot 'scripts\call-tool.js'

if (-not (Test-Path -LiteralPath $clientScript -PathType Leaf)) {
    throw "PS-MCP 本地客户端不存在：$clientScript"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'PS-MCP 要求 Node.js 20 或更高版本。'
}

if ($PrepareMcp) {
    Push-Location $mcpRoot
    try {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '安装 PS-MCP 锁定依赖失败。' }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $mcpRoot 'node_modules\@modelcontextprotocol\server'))) {
    throw 'PS-MCP 依赖尚未安装；请先增加 -PrepareMcp，或在 psd2ui/PS-MCP 执行 npm ci。'
}

try {
    $null = $PayloadJson | ConvertFrom-Json -Depth 100
} catch {
    throw "PayloadJson 不是有效 JSON：$($_.Exception.Message)"
}

$payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PayloadJson))
$clientArguments = @($clientScript, $ToolName, "base64:$payloadBase64")
if ($Maintenance) { $clientArguments += '--maintenance' }
& node @clientArguments
if ($LASTEXITCODE -ne 0) {
    throw "PS-MCP 工具 $ToolName 执行失败（exit=$LASTEXITCODE）。"
}
