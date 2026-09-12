/* Isolated Photoshop host smoke test. Does not launch Photoshop.
 * Caller must set $.PSD2UI_HOST_PATH and $.PSD2UI_SMOKE_ROOT first.
 * Run with $.PSD2UI_SMOKE_STAGE=1, then =2 in a SEPARATE DoJavaScript/evalScript
 * call, matching the production bridge's separate host invocations.
 * Only documents created here are changed/closed. Results and fresh files live
 * exclusively in the supplied output folder; no source PSD is modified.
 */
(function () {
    var stage = Number($.PSD2UI_SMOKE_STAGE || 1);
    if (stage !== 1 && stage !== 2) { throw new Error('PSD2UI_SMOKE_STAGE must be 1 or 2.'); }
    var outputFolder = new Folder(String($.PSD2UI_SMOKE_ROOT || ''));
    var hostFile = new File(String($.PSD2UI_HOST_PATH || ''));
    if (!$.PSD2UI_SMOKE_ROOT || !outputFolder.exists) { throw new Error('PSD2UI_SMOKE_ROOT must name an existing output directory.'); }
    if (!$.PSD2UI_HOST_PATH || !hostFile.exists) { throw new Error('PSD2UI_HOST_PATH must name the Photoshop host JSX.'); }
    $.evalFile(hostFile);
    var codec = $.PSD2UIHost.json;
    var sessionFile = new File(outputFolder.fsName + '/cep-smoke-session.json');
    var session = null;
    if (stage === 1 && sessionFile.exists) { throw new Error('An unfinished smoke session exists; run stage 2 to finish and clean it up.'); }
    if (stage === 2) {
        if (!sessionFile.exists) { throw new Error('Run stage 1 in a separate host call before stage 2.'); }
        sessionFile.encoding = 'UTF-8';
        if (!sessionFile.open('r')) { throw new Error('Cannot read smoke session.'); }
        try { session = codec.parse(sessionFile.read()); } finally { sessionFile.close(); }
        // A persisted session must never grant ownership over a reused document ID.
        var sourceCheck = documentById(session.sourceId), observerCheck = documentById(session.observerId);
        if (!sourceCheck || !observerCheck || sourceCheck.name !== session.sourceName || observerCheck.name !== session.observerName) {
            throw new Error('Smoke document identities changed between stages; no document was closed.');
        }
    }
    var previousDocumentId = null;
    if (session) { previousDocumentId = session.previousDocumentId; }
    else if (app.documents.length) { previousDocumentId = app.activeDocument.id; }
    var previousDialogs = app.displayDialogs;
    var createdIds = session ? session.createdIds : [];
    var results = session ? session.report.checks : [];
    var keepDocuments = false;
    var stamp = session ? session.stamp : String(new Date().getTime()) + '_' + Math.floor(Math.random() * 1000000);
    var report = session ? session.report : { ok: false, complete: false, photoshopVersion: String(app.version), hostPath: hostFile.fsName, checks: results, files: [] };
    function check(condition, message) { if (!condition) { throw new Error(message); } }
    function same(actual, expected, message) { check(codec.stringify(actual) === codec.stringify(expected), message); }
    function rpc(method, params) {
        var serialized = codec.stringify({ method: method, params: params || {} });
        report.lastRequest = serialized;
        var response = codec.parse($.PSD2UIHost.dispatch(serialized));
        if (!response.ok) { report.hostError = response.error; throw new Error(method + ': ' + response.error.code + ': ' + response.error.message); }
        return response;
    }
    function documentById(id) {
        for (var index = 0; index < app.documents.length; index += 1) { if (String(app.documents[index].id) === String(id)) { return app.documents[index]; } }
        return null;
    }
    function stateDocument(state, id) {
        for (var index = 0; index < state.documents.length; index += 1) { if (String(state.documents[index].id) === String(id)) { return state.documents[index]; } }
        throw new Error('State is missing document ' + id);
    }
    function stateLayer(layers, id) {
        if (id == null) { throw new Error('Cannot find a state layer without an ID.'); }
        for (var index = 0; index < layers.length; index += 1) {
            if (String(layers[index].id) === String(id)) { return layers[index]; }
            var nested = stateLayer(layers[index].layers || [], id); if (nested) { return nested; }
        }
        return null;
    }
    function treeSummary(layers) {
        var output = [];
        for (var index = 0; index < layers.length; index += 1) { output.push({ id: layers[index].id, name: layers[index].name, children: treeSummary(layers[index].layers || []) }); }
        return output;
    }
    function create(name, width, height) {
        var response = rpc('addDocument', { name: name, width: width, height: height, resolution: 144, mode: 'RGBColorMode', fill: 'transparent', depth: 8 });
        var id = response.value.documentId; createdIds.push(id); return id;
    }
    function rectangle(document, layer, left, top, right, bottom, red, green, blue) {
        app.activeDocument = document; document.activeLayer = layer;
        var color = new SolidColor(); color.rgb.red = red; color.rgb.green = green; color.rgb.blue = blue;
        document.selection.select([[left, top], [right, top], [right, bottom], [left, bottom]]);
        document.selection.fill(color); document.selection.deselect();
    }
    function filePath(name) {
        var file = new File(outputFolder.fsName + '/' + stamp + '-' + name);
        check(!file.exists, 'Smoke output already exists: ' + file.fsName); report.files.push(file.fsName); return file.fsName;
    }
    function pngChunks(path) {
        var file = new File(path); file.encoding = 'BINARY'; check(file.open('r'), 'Cannot read output PNG.');
        var bytes; try { bytes = file.read(); } finally { file.close(); }
        check(bytes.length > 33 && bytes.substr(1, 3) === 'PNG', 'Output file is not PNG.');
        var offset = 8, chunks = [];
        while (offset + 12 <= bytes.length) {
            var length = bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 + bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
            var kind = bytes.substr(offset + 4, 4); chunks.push(kind); offset += length + 12;
            if (kind === 'IEND') { break; }
        }
        return chunks;
    }
    function hasChunk(chunks, name) { for (var index = 0; index < chunks.length; index += 1) { if (chunks[index] === name) { return true; } } return false; }
    try {
        app.displayDialogs = DialogModes.NO;
        if (stage === 1) {
        var sourceId = create('PSD2UI_CEP_Smoke_' + stamp, 256, 128), document = documentById(sourceId);
        var base = document.layers[0]; base.name = 'SmokeBase'; rectangle(document, base, 10, 35, 100, 90, 220, 30, 50);
        var icon = document.artLayers.add(); icon.name = 'SmokeIcon'; rectangle(document, icon, 110, 45, 150, 85, 20, 180, 60);
        var textLayer = document.artLayers.add(); textLayer.kind = LayerKind.TEXT; textLayer.name = 'SmokeText';
        textLayer.textItem.contents = 'PSD2UI CEP smoke'; textLayer.textItem.size = new UnitValue(12, 'pt');
        textLayer.textItem.position = [new UnitValue(10, 'px'), new UnitValue(25, 'px')];
        var first = rpc('state').value, textState = stateLayer(stateDocument(first, sourceId).layers, textLayer.id);
        check(textState && textState.kind === 'text' && textState.textItem.contents === 'PSD2UI CEP smoke', 'Text state did not survive JSON RPC.');
        check(textState.descriptor.textKey, 'ActionManager textKey was not serialized.');
        results.push({ name: 'document/text/ActionDescriptor snapshot', ok: true, textLayerId: textLayer.id, textCharacterStyle: textState.textItem.characterStyle });

        var observerId = create('PSD2UI_CEP_Smoke_Observer_' + stamp, 16, 16), observerBefore = rpc('state').value;
        var observerAfter = rpc('state').value;
        same(observerAfter.activeDocumentId, observerBefore.activeDocumentId, 'Read-only state switched active documents.');
        same(stateDocument(observerAfter, sourceId).activeLayerIds, stateDocument(observerBefore, sourceId).activeLayerIds, 'Read-only state changed source selection.');
        results.push({ name: 'state does not activate documents or change selections', ok: true });

        rpc('select', { documentId: sourceId, layerIds: [icon.id, base.id] });
        var grouped = rpc('group', { documentId: sourceId, layerIds: [icon.id, base.id], name: 'SmokeGroup' });
        var groupId = grouped.value.layerId, group = stateLayer(stateDocument(grouped.state, sourceId).layers, groupId);
        same([group.layers[0].id, group.layers[1].id], [icon.id, base.id], 'Group changed member order.');
        check(group.blendMode === 'passThrough', 'New group is not passThrough.');
        report.historyBefore = treeSummary(stateDocument(grouped.state, sourceId).layers);
        results.push({ name: 'group member order and passThrough', ok: true, groupId: groupId });
        session = { previousDocumentId: previousDocumentId, createdIds: createdIds, stamp: stamp, report: report,
            sourceId: sourceId, sourceName: document.name, observerId: observerId, observerName: documentById(observerId).name,
            groupId: groupId, iconId: icon.id, baseId: base.id };
        report.ok = true; report.complete = false; report.phase = 'ready-for-stage-2';
        sessionFile.encoding = 'UTF-8'; check(sessionFile.open('w'), 'Cannot write smoke session.');
        try { sessionFile.write(codec.stringify(session)); } finally { sessionFile.close(); }
        keepDocuments = true;
        return codec.stringify(report);
        }
        sourceId = session.sourceId; observerId = session.observerId; groupId = session.groupId;
        icon = { id: session.iconId }; base = { id: session.baseId }; document = documentById(sourceId);
        check(document && documentById(observerId), 'A smoke document was closed between stages.');
        var history = rpc('beginHistory', { documentId: sourceId, name: 'Smoke rollback' }).value;
        rpc('setLayer', { documentId: sourceId, layerId: groupId, name: 'ShouldRollback' });
        rpc('activate', { documentId: observerId });
        var restored = rpc('endHistory', { token: history, commit: false });
        report.historyRecovery = restored.value;
        report.historyAfter = treeSummary(stateDocument(restored.state, sourceId).layers);
        var restoredGroup = stateLayer(stateDocument(restored.state, sourceId).layers, groupId);
        check(restoredGroup && restoredGroup.name === 'SmokeGroup', 'History snapshot did not restore the correct group identity/name.');
        results.push({ name: 'group order and history snapshot rollback by document ID', ok: true, groupId: groupId });

        var commitToken = rpc('beginHistory', { documentId: sourceId, name: 'Smoke commit' }).value;
        var edited = rpc('setLayer', { documentId: sourceId, layerId: groupId, name: 'SmokeGroupCommitted' });
        var committed = rpc('endHistory', { token: commitToken, commit: true });
        same(treeSummary(stateDocument(committed.state, sourceId).layers), treeSummary(stateDocument(edited.state, sourceId).layers), 'Commit snapshot cleanup changed document history.');
        check(stateLayer(stateDocument(committed.state, sourceId).layers, groupId).name === 'SmokeGroupCommitted', 'Commit removed the layer edit.');
        results.push({ name: 'history commit retains edits while cleaning its snapshot', ok: true });

        var copyResponse = rpc('duplicate', { documentId: sourceId, layerId: icon.id }), copyId = copyResponse.value.layerId;
        report.duplicate = { value: copyResponse.value, copyId: copyId, copyIdType: typeof copyId, groupId: groupId,
            sourceId: sourceId, iconId: icon.id, activeLayerIds: stateDocument(copyResponse.state, sourceId).activeLayerIds,
            tree: treeSummary(stateDocument(copyResponse.state, sourceId).layers) };
        check(copyId != null, 'Duplicate RPC did not return a layer ID.');
        var copiedState = stateLayer(stateDocument(copyResponse.state, sourceId).layers, copyId);
        check(copiedState != null, 'Duplicate RPC returned an ID absent from state: ' + copyId);
        var copiedBefore = copiedState.bounds;
        var moved = rpc('move', { documentId: sourceId, layerId: copyId, parentId: 'document-root', beforeId: groupId });
        same(stateLayer(stateDocument(moved.state, sourceId).layers, copyId).bounds, copiedBefore, 'Move changed absolute pixel bounds.');
        rpc('delete', { documentId: sourceId, layerId: copyId });
        var ungrouped = rpc('ungroup', { documentId: sourceId, layerId: groupId });
        same(ungrouped.value.childIds, [icon.id, base.id], 'Ungroup changed child IDs.');
        check(!stateLayer(stateDocument(ungrouped.state, sourceId).layers, groupId), 'Ungroup left a container.');
        results.push({ name: 'duplicate/move/delete/ungroup preserve identities and bounds', ok: true });

        if (!ExternalObject.AdobeXMPScript) { ExternalObject.AdobeXMPScript = new ExternalObject('lib:AdobeXMPScript'); }
        var otherNamespace = 'https://yoyoengine.dev/psd2ui/smoke/'; XMPMeta.registerNamespace(otherNamespace, 'psd2uiSmoke');
        var metadata = new XMPMeta(document.xmpMetadata.rawData || ''); metadata.setProperty(otherNamespace, 'Keep', 'unrelated');
        rpc('setXmp', { documentId: sourceId, rawXmp: metadata.serialize() });
        var manifest = { schemaVersion: '1.5', document: { id: 'cep-smoke-' + stamp }, names: ['中文', 'quote"', 'backslash\\', 'line\nfeed'] };
        rpc('writeManifest', { documentId: sourceId, manifest: manifest });
        same(rpc('readManifest', { documentId: sourceId }).value, manifest, 'XMP Manifest JSON did not round trip.');
        var xmpAfter = new XMPMeta(rpc('getXmp', { documentId: sourceId }).value);
        check(String(xmpAfter.getProperty(otherNamespace, 'Keep').value) === 'unrelated', 'Manifest write removed unrelated XMP.');
        var psdPath = filePath('smoke.psd'), psdOptions = new PhotoshopSaveOptions(); psdOptions.layers = true;
        document.saveAs(new File(psdPath), psdOptions, false, Extension.LOWERCASE);
        rpc('save', { documentId: sourceId });
        results.push({ name: 'XMP namespace preservation and local PSD save', ok: true, path: psdPath });

        var pngPath = filePath('pixels.png'), exported = rpc('exportPixels', { documentId: sourceId, path: pngPath, colorProfile: 'sRGB IEC61966-2.1' }).value;
        same([exported.width, exported.height], [256, 128], 'Pixel export dimensions changed.');
        check(exported.colorProfile === 'sRGB IEC61966-2.1', 'Export did not use the requested ICC profile.');
        var chunks = pngChunks(pngPath);
        check(hasChunk(chunks, 'iCCP') || hasChunk(chunks, 'sRGB'), 'Export PNG has no ICC/sRGB color metadata.');
        var outputId = create('PSD2UI_NineSlice_Output', 256, 128), outputLayerId = documentById(outputId).layers[0].id;
        var imported = rpc('importPixels', { documentId: outputId, layerId: outputLayerId, path: pngPath, colorProfile: exported.colorProfile, replace: true,
            targetBounds: { left: 0, top: 0, width: 256, height: 128 } });
        check(stateDocument(imported.state, outputId).layers.length === 1, 'Pixel import left more than one output layer.');
        var roundTripPath = filePath('roundtrip.png'); rpc('savePng', { documentId: outputId, path: roundTripPath, compression: 6 });
        results.push({ name: 'PNG export/import with ICC and transparent canvas', ok: true, pixelFile: pngPath, roundTripFile: roundTripPath, pngChunks: chunks, outputLayerId: imported.value.layerId });
        report.ok = true; report.complete = true; report.phase = 'complete';
    } catch (error) {
        report.ok = false; report.complete = false; report.phase = 'failed';
        report.error = { message: String(error.message || error), line: error.line || null, number: error.number || null };
    } finally {
        var cleanupErrors = [];
        for (var index = keepDocuments ? -1 : createdIds.length - 1; index >= 0; index -= 1) {
            var ownedDocument = documentById(createdIds[index]);
            if (ownedDocument) {
                try { app.activeDocument = ownedDocument; ownedDocument.close(SaveOptions.DONOTSAVECHANGES); }
                catch (cleanupError) { cleanupErrors.push(String(createdIds[index]) + ': ' + cleanupError.message); }
            }
        }
        var original = previousDocumentId == null ? null : documentById(previousDocumentId);
        if (original) { app.activeDocument = original; }
        app.displayDialogs = previousDialogs;
        if (cleanupErrors.length) { report.ok = false; report.cleanupErrors = cleanupErrors; }
        if (!keepDocuments && sessionFile.exists && cleanupErrors.length === 0) { sessionFile.remove(); }
        var reportFile = new File(outputFolder.fsName + '/cep-smoke-result.json'); reportFile.encoding = 'UTF-8';
        if (!reportFile.open('w')) { throw new Error('Cannot write CEP smoke report: ' + reportFile.fsName); }
        try { reportFile.write(codec.stringify(report)); } finally { reportFile.close(); }
        $.PSD2UI_SMOKE_RESULT = codec.stringify(report);
    }
    return $.PSD2UI_SMOKE_RESULT;
}());
