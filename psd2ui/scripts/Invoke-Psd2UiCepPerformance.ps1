#requires -Version 5.1
[CmdletBinding()]
param([string]$BaselineHostPath = '', [string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
if (-not (Get-Process -Name Photoshop -ErrorAction SilentlyContinue)) {
    throw 'Open Photoshop before running the isolated host benchmark.'
}
$cepPerfRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $cepPerfRoot '.tmp/cep-performance' }
$cepPerfOutput = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($cepPerfOutput) | Out-Null
$cepPerfCurrent = Join-Path $cepPerfRoot 'Plus-ins/PSD2UI-CEP/host/photoshop.jsx'
if (-not $BaselineHostPath) { $BaselineHostPath = $cepPerfCurrent }
$cepPerfSources = @([IO.Path]::GetFullPath($BaselineHostPath), $cepPerfCurrent)
$cepPerfCopies = @()
for ($cepPerfIndex = 0; $cepPerfIndex -lt 2; $cepPerfIndex++) {
    $cepPerfCopy = Join-Path $cepPerfOutput ("isolated-selection-$cepPerfIndex.jsx")
    $cepPerfCode = [IO.File]::ReadAllText($cepPerfSources[$cepPerfIndex]).Replace('$.PSD2UIHost', '$.PSD2UIPerformanceHost')
    $cepPerfCode = $cepPerfCode.Replace("executeAction(sid('select'), descriptor, DialogModes.NO);", "$.PSD2UIPerformanceSelects += 1; executeAction(sid('select'), descriptor, DialogModes.NO);")
    [IO.File]::WriteAllText($cepPerfCopy, $cepPerfCode)
    $cepPerfCopies += $cepPerfCopy.Replace('\', '/')
}
$cepPerfScript = @'
(function () {
    var previous = app.documents.length ? app.activeDocument : null, fixture = null;
    var previousDialogs = app.displayDialogs, results = [];
    try {
        app.displayDialogs = DialogModes.NO;
        fixture = app.documents.add(new UnitValue(64, 'px'), new UnitValue(64, 'px'), 72,
            'PSD2UI_Performance_' + new Date().getTime(), NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        while (fixture.layers.length < 12) { fixture.artLayers.add(); }
        var ids = [], i;
        for (i = 0; i < fixture.layers.length; i++) { ids.push(fixture.layers[i].id); }
        var paths = __PATHS__;
        for (var variant = 0; variant < 2; variant++) {
            $.evalFile(File(paths[variant]));
            var host = $.PSD2UIPerformanceHost, codec = host.json, calls = 0;
            function rpc(method, params) {
                calls++;
                var response = codec.parse(host.dispatch(codec.stringify({ method: method, params: params || {}, deferState: true })));
                if (!response.ok) { throw Error(codec.stringify(response.error)); }
                return response.value;
            }
            var known = rpc('probe').documents;
            calls = 0; $.PSD2UIPerformanceSelects = 0;
            var started = new Date().getTime();
            if (variant === 0) {
                for (i = 0; i < ids.length; i++) {
                    rpc('select', { documentId: fixture.id, layerIds: [ids[i]], add: i > 0 });
                    var begin = rpc('beginState', { knownDocuments: known });
                    rpc('statePage', { token: begin.token }); known = begin.stamp.documents;
                }
            } else {
                rpc('select', { documentId: fixture.id, layerIds: ids }); rpc('probe');
            }
            var elapsed = new Date().getTime() - started, measuredCalls = calls;
            var checked = rpc('probe'), selected = null;
            for (i = 0; i < checked.documents.length; i++) {
                if (checked.documents[i].id === fixture.id) { selected = checked.documents[i].activeLayerIds.slice().sort(); }
            }
            if (codec.stringify(selected) !== codec.stringify(ids.slice().sort())) { throw Error('Selection readback mismatch.'); }
            results.push({ mode: variant === 0 ? 'individual-selection' : 'batched-selection', milliseconds: elapsed,
                hostCalls: measuredCalls, nativeSelectActions: $.PSD2UIPerformanceSelects, selectedLayers: selected.length });
        }
        return codec.stringify({ photoshopVersion: String(app.version), isolatedDocument: true, results: results });
    } finally {
        if (fixture) { fixture.close(SaveOptions.DONOTSAVECHANGES); }
        if (previous) { app.activeDocument = previous; }
        app.displayDialogs = previousDialogs;
    }
}());
'@
$cepPerfApp = New-Object -ComObject Photoshop.Application
$cepPerfRaw = $cepPerfApp.DoJavaScript($cepPerfScript.Replace('__PATHS__', (ConvertTo-Json -InputObject $cepPerfCopies -Compress)))
[IO.File]::WriteAllText((Join-Path $cepPerfOutput 'host-selection-benchmark.json'), $cepPerfRaw)
$cepPerfRaw
