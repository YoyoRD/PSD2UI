#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('^Photoshop\.Application(?:\.[0-9]+)?$')]
    [string]$ProgId = 'Photoshop.Application',
    [ValidateRange(0, 999)]
    [int]$ExpectedVersionMajor = 0
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$sessionPhotoshop = $null
try {
    # Attach only to an existing ROT entry; COM must never start another installation.
    $sessionPhotoshop = [Runtime.InteropServices.Marshal]::GetActiveObject($ProgId)
    $sessionVersion = [string]$sessionPhotoshop.Version
    $sessionMajor = [int]($sessionVersion.Split('.')[0])
    if ($ExpectedVersionMajor -ne 0 -and $sessionMajor -ne $ExpectedVersionMajor) {
        throw "Photoshop version mismatch: $ProgId returned $sessionVersion; expected major $ExpectedVersionMajor. No script was submitted."
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject @{
        type = 'ready'; progId = $ProgId; photoshopVersion = $sessionVersion; photoshopPath = [string]$sessionPhotoshop.Path
    } -Compress))
    while ($null -ne ($sessionLine = [Console]::ReadLine())) {
        try {
            $sessionRequest = ConvertFrom-Json -InputObject $sessionLine
            $sessionValue = $sessionPhotoshop.DoJavaScript([string]$sessionRequest.script)
            [Console]::WriteLine((ConvertTo-Json -InputObject @{ ok = $true; value = $sessionValue } -Compress))
        } catch {
            [Console]::WriteLine((ConvertTo-Json -InputObject @{ ok = $false; error = $_.Exception.Message } -Compress))
        }
    }
} finally {
    if ($sessionPhotoshop) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($sessionPhotoshop) }
}
