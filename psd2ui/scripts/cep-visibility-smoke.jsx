/* Run in an already-open Photoshop. Set $.PSD2UI_VISIBILITY_HOST and
 * $.PSD2UI_VISIBILITY_REPORT to absolute paths. Only a new document duplicate
 * is edited/closed; the source and the running panel host are restored. */
(function () {
    var oldHost = $.PSD2UIHost, original = app.activeDocument, copy = null, copyId = null;
    var reportFile = new File($.PSD2UI_VISIBILITY_REPORT), report = { ok: false, photoshopVersion: String(app.version) };
    var codec;
    try {
        $.evalFile(new File($.PSD2UI_VISIBILITY_HOST));
        codec = $.PSD2UIHost.json;
        function rpc(method, params) {
            var response = codec.parse($.PSD2UIHost.dispatch(codec.stringify({ method: method, params: params || {}, deferState: true })));
            if (!response.ok) throw new Error(method + ': ' + response.error.message);
            return response.value;
        }
        function originalStamp() {
            var documents = rpc('probe').documents;
            for (var i = 0; i < documents.length; i++) if (String(documents[i].id) === String(original.id)) return codec.stringify(documents[i]);
            throw new Error('Source document disappeared');
        }
        var before = originalStamp();
        copy = original.duplicate('PSD2UI_Visibility_Test_' + new Date().getTime());
        if (copy.id === original.id) throw new Error('Duplicate returned source');
        copyId = copy.id;
        var started = new Date().getTime(), begin = rpc('beginState'), page, items = [], known = {};
        do {
            page = rpc('statePage', { token: begin.token });
            for (var i = 0; i < page.items.length; i++) {
                var item = page.items[i];
                if (String(item.documentId) === String(copyId)) { items.push(item); known[String(item.layer.id)] = item; }
            }
        } while (!page.done);
        report.fullReadMs = new Date().getTime() - started;
        report.layerCount = items.length;
        var chosen = null;
        for (var i = 0; i < items.length; i++) if (items[i].layer.name === 'comm_sp_0031' && items[i].layer.kind !== 'group') { chosen = items[i]; break; }
        if (!chosen) throw new Error('Sample has no comm_sp_0031 layer');
        function find(layers, id) {
            for (var i = 0; i < layers.length; i++) {
                if (String(layers[i].id) === String(id)) return layers[i];
                if (layers[i].typename === 'LayerSet') { var nested = find(layers[i].layers, id); if (nested) return nested; }
            }
            return null;
        }
        var target = find(copy.layers, chosen.layer.id), wasVisible = target.visible;
        target.visible = !wasVisible;
        var ids = [String(target.id)], groups = [], parent = chosen.parentId;
        while (parent != null) { ids.push(String(parent)); groups.push(String(parent)); parent = known[String(parent)].parentId; }
        var current = rpc('probe');
        started = new Date().getTime();
        var changed = rpc('readVisibility', { documentId: copyId, layerIds: [String(target.id)], groupIds: [], stamp: current });
        report.partialReadMs = new Date().getTime() - started;
        report.partialLayerCount = changed.layers.length;
        if (changed.layers[0].visible !== !wasVisible) throw new Error('Visibility readback differs');
        for (var i = 1; i < changed.layers.length; i++) {
            var actual = find(copy.layers, changed.layers[i].id).bounds, got = changed.layers[i].bounds;
            if (Math.abs(actual[0].as('px') - got.left) > 0.01 || Math.abs(actual[3].as('px') - got.bottom) > 0.01) throw new Error('Ancestor bounds differ');
        }
        ids = []; groups = [];
        for (var i = 0; i < items.length; i++) { ids.push(String(items[i].layer.id)); if (items[i].layer.kind === 'group') groups.push(String(items[i].layer.id)); }
        started = new Date().getTime();
        var all = rpc('readVisibility', { documentId: copyId, layerIds: ids, groupIds: [], stamp: rpc('probe') });
        report.allVisibilityReadMs = new Date().getTime() - started;
        if (all.layers.length !== items.length) throw new Error('Missing visibility records');
        // Avoid an O(n squared) DOM verification walk on a complex live document.
        for (var i = 0; i < all.layers.length; i++) {
            var entry = all.layers[i], expected = String(entry.id) === String(target.id) ? !wasVisible : known[String(entry.id)].layer.visible;
            if (entry.visible !== expected) throw new Error('Full visibility differs');
        }
        report.sourceUnchanged = originalStamp() === before;
        if (!report.sourceUnchanged) throw new Error('Source stamp changed');
        report.ok = true;
    } catch (error) { report.error = String(error.message || error); }
    finally {
        if (copy && copyId != null && copy.id === copyId && copyId !== original.id) { app.activeDocument = copy; copy.close(SaveOptions.DONOTSAVECHANGES); }
        app.activeDocument = original;
        $.PSD2UIHost = oldHost;
    }
    if (!codec) throw new Error(report.error);
    reportFile.encoding = 'UTF-8';
    if (!reportFile.open('w')) throw new Error('Cannot write visibility report');
    try { reportFile.write(codec.stringify(report)); } finally { reportFile.close(); }
    return codec.stringify(report);
}());
