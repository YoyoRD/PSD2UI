[CmdletBinding()]
param(
    [ValidateSet('Status', 'Reload', 'Invoke')]
    [string]$Operation = 'Status',

    [string]$Method,

    [string]$PayloadJson = '{}',

    [switch]$PreparePlugin,

    [string]$ManifestPath,

    [string]$UdtRoot = 'C:\Program Files\Adobe\Adobe UXP Developer Tools',

    [int]$ServicePort = 14001,

    [int]$TimeoutMilliseconds = 600000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDirectory = Split-Path -Parent $PSCommandPath
$psd2UiRoot = [IO.Path]::GetFullPath((Join-Path $scriptDirectory '..'))
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $psd2UiRoot 'Plus-ins\PSD2UI\manifest.json'
}
$resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)
$udtExecutable = Join-Path $UdtRoot 'Adobe UXP Developer Tools.exe'
$runnerPath = Join-Path $scriptDirectory 'uxp-devtools-runner.js'

if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    throw "PSD2UI 插件 Manifest 不存在：$resolvedManifest"
}
if (-not (Test-Path -LiteralPath $udtExecutable -PathType Leaf)) {
    throw "Adobe UXP Developer Tools 不存在：$udtExecutable"
}
if (-not (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) {
    throw 'Photoshop 尚未运行。请先打开目标 PSD。'
}
if ($Operation -eq 'Invoke' -and [string]::IsNullOrWhiteSpace($Method)) {
    throw 'Invoke 操作必须提供 -Method。'
}

if ($PreparePlugin) {
    Push-Location $psd2UiRoot
    try {
        & npm.cmd run sync
        if ($LASTEXITCODE -ne 0) { throw '同步 Photoshop generated/core 失败。' }
        & npm.cmd test
        if ($LASTEXITCODE -ne 0) { throw 'PSD2UI Node/UXP 测试失败。' }
        & npm.cmd run check:generated
        if ($LASTEXITCODE -ne 0) { throw 'Photoshop generated/core 一致性检查失败。' }
    } finally {
        Pop-Location
    }
}

$runnerArguments = @(
    $runnerPath,
    '--operation', $Operation.ToLowerInvariant(),
    '--manifest', $resolvedManifest,
    '--udt-root', $UdtRoot,
    '--service-port', $ServicePort.ToString([Globalization.CultureInfo]::InvariantCulture),
    '--timeout-ms', $TimeoutMilliseconds.ToString([Globalization.CultureInfo]::InvariantCulture)
)
if ($Operation -eq 'Invoke') {
    try {
        $null = $PayloadJson | ConvertFrom-Json
    } catch {
        throw "PayloadJson 不是有效 JSON：$($_.Exception.Message)"
    }
    $payloadBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PayloadJson))
    $runnerArguments += @('--method', $Method, '--payload-base64', $payloadBase64)
}

$processStartInfo = [Diagnostics.ProcessStartInfo]::new()
$processStartInfo.FileName = $udtExecutable
$processStartInfo.UseShellExecute = $false
$processStartInfo.CreateNoWindow = $true
$processStartInfo.RedirectStandardOutput = $true
$processStartInfo.RedirectStandardError = $true
$processStartInfo.Environment['ELECTRON_RUN_AS_NODE'] = '1'
foreach ($argument in $runnerArguments) {
    $processStartInfo.ArgumentList.Add($argument)
}

$process = [Diagnostics.Process]::new()
$process.StartInfo = $processStartInfo
try {
    if (-not $process.Start()) {
        throw '无法启动 Adobe UXP Developer Tools 的 Node 运行时。'
    }
    $standardOutputTask = $process.StandardOutput.ReadToEndAsync()
    $standardErrorTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $standardOutput = $standardOutputTask.GetAwaiter().GetResult()
    $standardError = $standardErrorTask.GetAwaiter().GetResult()
    if (-not [string]::IsNullOrEmpty($standardError)) {
        [Console]::Error.Write($standardError)
    }
    if (-not [string]::IsNullOrEmpty($standardOutput)) {
        [Console]::Out.Write($standardOutput)
    }
    if ($process.ExitCode -ne 0) {
        throw "PSD2UI Photoshop 开发操作失败（exit=$($process.ExitCode)）。"
    }
} finally {
    $process.Dispose()
}
