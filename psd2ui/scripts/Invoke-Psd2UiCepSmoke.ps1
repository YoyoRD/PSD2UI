#requires -Version 5.1
[CmdletBinding()]
param([string]$OutputDirectory = '', [string]$PhotoshopProgId = 'Photoshop.Application')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) {
    throw 'Open the Photoshop version to test before running this isolated host check.'
}
$cepSmokeToolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $cepSmokeToolRoot '.tmp/cep-smoke' }
$cepSmokeOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($cepSmokeOutput) | Out-Null
$cepSmokeHost = [IO.Path]::GetFullPath((Join-Path $cepSmokeToolRoot 'Plus-ins/PSD2UI-CEP/host/photoshop.jsx'))
$cepSmokeScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'cep-smoke.jsx'))
$cepSmokeSetup = '$.PSD2UI_HOST_PATH=' + (ConvertTo-Json -InputObject $cepSmokeHost -Compress) + ';'
$cepSmokeSetup += '$.PSD2UI_SMOKE_ROOT=' + (ConvertTo-Json -InputObject $cepSmokeOutput -Compress) + ';'
$cepSmokeCall = '$.evalFile(File(' + (ConvertTo-Json -InputObject $cepSmokeScript -Compress) + '));$.PSD2UI_SMOKE_RESULT;'
$cepSmokeApplication = New-Object -ComObject $PhotoshopProgId
foreach ($cepSmokeStage in @(1, 2)) {
    $cepSmokeRaw = $cepSmokeApplication.DoJavaScript($cepSmokeSetup + '$.PSD2UI_SMOKE_STAGE=' + $cepSmokeStage + ';' + $cepSmokeCall)
    $cepSmokeResult = ConvertFrom-Json -InputObject $cepSmokeRaw
    if (-not $cepSmokeResult.ok) {
        throw "Photoshop host smoke stage $cepSmokeStage failed: $($cepSmokeResult.error.message). Report: $cepSmokeOutput/cep-smoke-result.json"
    }
}
if (-not $cepSmokeResult.complete) { throw 'Photoshop did not finish the isolated smoke check.' }
$cepSmokeResult | ConvertTo-Json -Depth 20
