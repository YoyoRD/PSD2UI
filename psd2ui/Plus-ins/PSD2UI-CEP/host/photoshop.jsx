/* PSD2UI Photoshop 20+ host. ExtendScript / ECMAScript 3 only.
 * This bridge executes a fixed command vocabulary, never caller-provided script.
 * History snapshots are compensating recovery across RPCs, not UXP modal scopes.
 */
(function () {
    if (typeof $ === 'undefined') { throw new Error('ExtendScript global is unavailable.'); }
    var namespaceUri = 'https://yoyoengine.dev/psd2ui/1.0/';
    var namespacePrefix = 'yoyoPsd2ui';
    var propertyName = 'Manifest';
    var historyTokens = {};
    var temporaryDocuments = {};
    var serial = 0;
    var stateRead = null;
    var layerLookups = {};
    var own = Object.prototype.hasOwnProperty;

    function has(value, key) { return own.call(value, key); }
    function fail(message, code) {
        var error = new Error(message);
        error.code = code || 'PSD2UI_HOST_ERROR';
        throw error;
    }
    function finite(value, label) {
        var number = Number(value);
        if (!isFinite(number)) { fail(label + ' must be a finite number.', 'PSD2UI_INVALID_ARGUMENT'); }
        return number;
    }
    function text(value, label) {
        var result = value == null ? '' : String(value);
        if (!result.replace(/^\s+|\s+$/g, '')) { fail(label + ' is required.', 'PSD2UI_INVALID_ARGUMENT'); }
        return result;
    }
    function identifier(params, first, second) {
        return params[first] != null ? params[first] : params[second];
    }
    function docId(params) { return identifier(params, 'documentId', 'documentID'); }
    function layerId(params) { return identifier(params, 'layerId', 'layerID'); }
    function uid(label) { serial += 1; return 'PSD2UI_' + label + '_' + new Date().getTime() + '_' + serial; }
    function pixels(value) {
        if (value && typeof value.as === 'function') { return finite(value.as('px'), 'Pixel value'); }
        return finite(value && value.value != null ? value.value : value, 'Pixel value');
    }
    function px(value) { return new UnitValue(finite(value, 'Pixel value'), 'px'); }
    function bounds(value) {
        return { left: pixels(value[0]), top: pixels(value[1]), right: pixels(value[2]), bottom: pixels(value[3]) };
    }
    function normalizedPath(value) { return String(value || '').replace(/\\/g, '/').toLowerCase(); }
    function nativePath(value) {
        var result = text(value, 'path');
        if (/^file:\//i.test(result)) { result = result.replace(/^file:\/+/i, ''); }
        if (/^[a-z]+:/i.test(result) && !/^[a-z]:[\/\\]/i.test(result)) {
            fail('Only local filesystem paths are supported.', 'PSD2UI_LOCAL_PATH_REQUIRED');
        }
        return result;
    }

    // Small JSON codec: no eval, external dependencies, or pollution of the host JSON global.
    function parseJson(input) {
        var source = String(input), position = 0;
        // In ExtendScript even charAt/substring on a megabyte string are costly.
        // Scan a small cached window, without repeatedly copying the full source.
        var windowStart = -1, windowText = '';
        function characterAt(index) {
            if (index < windowStart || index >= windowStart + windowText.length) {
                windowStart = index; windowText = source.substr(index, 2048);
            }
            return windowText.charAt(index - windowStart);
        }
        function slice(start, end) {
            if (start >= windowStart && end <= windowStart + windowText.length) { return windowText.substring(start - windowStart, end - windowStart); }
            return source.substring(start, end);
        }
        function whitespace() { while (position < source.length && /\s/.test(characterAt(position))) { position += 1; } }
        function stringValue() {
            var parts = [], chunks = [], character, escape, hex, chunk, special;
            var escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
            function append(part) {
                parts.push(part);
                // ExtendScript's large arrays become very costly while decoding
                // escaped JSON inside an RPC string. Bound the accumulation too.
                if (parts.length >= 128) { chunks.push(parts.join('')); parts = []; }
            }
            position += 1;
            while (position < source.length) {
                characterAt(position); // Ensure the bounded window covers this offset.
                chunk = windowText.substring(position - windowStart);
                special = /["\\\x00-\x1f]/.exec(chunk);
                if (!special) { append(chunk); position += chunk.length; continue; }
                append(chunk.substring(0, special.index));
                position += special.index;
                character = characterAt(position++);
                if (character === '"') { chunks.push(parts.join('')); return chunks.join(''); }
                if (character === '\\') {
                    escape = characterAt(position++);
                    if (escape === 'u') {
                        hex = source.substr(position, 4);
                        if (!/^[0-9a-fA-F]{4}$/.test(hex)) { fail('Invalid JSON Unicode escape.', 'PSD2UI_INVALID_JSON'); }
                        append(String.fromCharCode(parseInt(hex, 16))); position += 4;
                    } else {
                        if (!has(escapes, escape)) { fail('Invalid JSON escape.', 'PSD2UI_INVALID_JSON'); }
                        append(escapes[escape]);
                    }
                } else {
                    if (character.charCodeAt(0) < 32) { fail('Unescaped JSON control character.', 'PSD2UI_INVALID_JSON'); }
                }
            }
            fail('Unterminated JSON string.', 'PSD2UI_INVALID_JSON');
        }
        function value() {
            whitespace();
            var character = characterAt(position), result, key, match;
            if (character === '"') { return stringValue(); }
            if (character === '{') {
                result = {}; position += 1; whitespace();
                if (characterAt(position) === '}') { position += 1; return result; }
                while (position < source.length) {
                    whitespace();
                    if (characterAt(position) !== '"') { fail('JSON object key expected.', 'PSD2UI_INVALID_JSON'); }
                    key = stringValue(); whitespace();
                    if (key === '__proto__') { fail('Reserved JSON object key.', 'PSD2UI_INVALID_JSON'); }
                    if (characterAt(position++) !== ':') { fail('JSON colon expected.', 'PSD2UI_INVALID_JSON'); }
                    result[key] = value(); whitespace(); character = characterAt(position++);
                    if (character === '}') { return result; }
                    if (character !== ',') { fail('JSON comma expected.', 'PSD2UI_INVALID_JSON'); }
                }
            } else if (character === '[') {
                result = []; position += 1; whitespace();
                if (characterAt(position) === ']') { position += 1; return result; }
                while (position < source.length) {
                    result.push(value()); whitespace(); character = characterAt(position++);
                    if (character === ']') { return result; }
                    if (character !== ',') { fail('JSON array comma expected.', 'PSD2UI_INVALID_JSON'); }
                }
            } else {
                if (character === 't' && source.substr(position, 4) === 'true') { position += 4; return true; }
                if (character === 'f' && source.substr(position, 5) === 'false') { position += 5; return false; }
                if (character === 'n' && source.substr(position, 4) === 'null') { position += 4; return null; }
                // Never copy the remaining megabyte string for each number.
                var numberStart = position;
                while (position < source.length && /[0-9eE+.-]/.test(characterAt(position))) { position += 1; }
                var numberText = slice(numberStart, position);
                match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.exec(numberText);
                if (match) { return finite(numberText, 'JSON number'); }
            }
            fail('Invalid JSON at character ' + position + '.', 'PSD2UI_INVALID_JSON');
        }
        var output = value(); whitespace();
        if (position !== source.length) { fail('Unexpected data after JSON.', 'PSD2UI_INVALID_JSON'); }
        return output;
    }
    function stringifyJson(input) {
        var parents = [];
        function quote(value) {
            // ExtendScript's replace callback becomes quadratic on long XMP/text
            // strings. Bound each replacement and join once (also used by getXmp).
            var source = String(value), chunks = [], offset;
            function escapeCharacter(character) {
                var known = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
                return has(known, character) ? known[character] : '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
            }
            for (offset = 0; offset < source.length; offset += 2048) {
                chunks.push(source.substr(offset, 2048).replace(/["\\\x00-\x1f\u2028\u2029]/g, escapeCharacter));
            }
            return '"' + chunks.join('') + '"';
        }
        function encode(value) {
            if (value === null || typeof value === 'undefined') { return 'null'; }
            if (typeof value === 'string') { return quote(value); }
            if (typeof value === 'number') { return isFinite(value) ? String(value) : 'null'; }
            if (typeof value === 'boolean') { return value ? 'true' : 'false'; }
            if (typeof value !== 'object') { fail('Non-JSON response value.', 'PSD2UI_SERIALIZATION_ERROR'); }
            var index, key, parts = [], isArray = Object.prototype.toString.call(value) === '[object Array]';
            for (index = 0; index < parents.length; index += 1) {
                if (parents[index] === value) { fail('Circular response value.', 'PSD2UI_SERIALIZATION_ERROR'); }
            }
            parents.push(value);
            if (isArray) {
                for (index = 0; index < value.length; index += 1) { parts.push(encode(value[index])); }
            } else {
                for (key in value) {
                    if (has(value, key) && typeof value[key] !== 'undefined' && typeof value[key] !== 'function') {
                        parts.push(quote(key) + ':' + encode(value[key]));
                    }
                }
            }
            parents.pop(); return isArray ? '[' + parts.join(',') + ']' : '{' + parts.join(',') + '}';
        }
        return encode(input);
    }

    function sid(name) { return app.stringIDToTypeID(name); }
    function cid(name) { return app.charIDToTypeID(name); }
    function typeName(id) {
        var name = '';
        try { name = app.typeIDToStringID(id); } catch (ignoreString) {}
        if (!name) {
            try { name = app.typeIDToCharID(id); } catch (ignoreChar) {}
        }
        var names = { '#Pxl': 'pixelsUnit', '#Pnt': 'pointsUnit', '#Prc': 'percentUnit', '#Ang': 'angleUnit', '#Rsl': 'densityUnit', '#Rlt': 'distanceUnit' };
        return has(names, name) ? names[name] : (name || String(id));
    }
    function convertReference(reference) {
        var output = [], current = reference, item, form;
        while (current) {
            if (output.length >= 32) { fail('ActionReference container chain is too deep.', 'PSD2UI_REFERENCE_DEPTH'); }
            item = { _ref: typeName(current.getDesiredClass()) }; form = current.getForm();
            if (form === ReferenceFormType.IDENTIFIER) { item._id = current.getIdentifier(); }
            else if (form === ReferenceFormType.INDEX) { item._index = current.getIndex(); }
            else if (form === ReferenceFormType.NAME) { item._name = current.getName(); }
            else if (form === ReferenceFormType.PROPERTY) { item._property = typeName(current.getProperty()); }
            else if (form === ReferenceFormType.ENUMERATED) {
                item._enum = typeName(current.getEnumeratedType()); item._value = typeName(current.getEnumeratedValue());
            } else if (form === ReferenceFormType.OFFSET) { item._offset = current.getOffset(); }
            output.push(item);
            try { current = current.getContainer(); current.getDesiredClass(); } catch (end) { current = null; }
        }
        return output.length === 1 ? output[0] : output;
    }
    function convertValue(container, key) {
        var type = container.getType(key), list, result, index;
        if (type === DescValueType.BOOLEANTYPE) { return container.getBoolean(key); }
        if (type === DescValueType.STRINGTYPE) { return container.getString(key); }
        if (type === DescValueType.INTEGERTYPE) { return container.getInteger(key); }
        if (type === DescValueType.LARGEINTEGERTYPE) { return container.getLargeInteger(key); }
        if (type === DescValueType.DOUBLETYPE) { return container.getDouble(key); }
        if (type === DescValueType.UNITDOUBLE) { return { _unit: typeName(container.getUnitDoubleType(key)), _value: container.getUnitDoubleValue(key) }; }
        if (type === DescValueType.ENUMERATEDTYPE) { return { _enum: typeName(container.getEnumerationType(key)), _value: typeName(container.getEnumerationValue(key)) }; }
        if (type === DescValueType.OBJECTTYPE) { return convertDescriptor(container.getObjectValue(key), typeName(container.getObjectType(key))); }
        if (type === DescValueType.LISTTYPE) {
            list = container.getList(key); result = [];
            for (index = 0; index < list.count; index += 1) { result.push(convertValue(list, index)); }
            return result;
        }
        if (type === DescValueType.REFERENCETYPE) { return convertReference(container.getReference(key)); }
        if (type === DescValueType.ALIASTYPE) { return { _path: String(container.getPath(key).fsName), _kind: 'local' }; }
        if (type === DescValueType.CLASSTYPE) { return { _class: typeName(container.getClass(key)) }; }
        if (type === DescValueType.RAWTYPE) {
            var data = container.getData(key), hex = '';
            for (index = 0; index < data.length; index += 1) { hex += ('0' + data.charCodeAt(index).toString(16)).slice(-2); }
            return { _rawData: hex };
        }
        fail('Unsupported ActionDescriptor value type ' + type + '.', 'PSD2UI_DESCRIPTOR_TYPE_UNSUPPORTED');
    }
    function convertDescriptor(descriptor, objectType) {
        var result = {}, index, key;
        if (objectType) { result._obj = objectType; }
        for (index = 0; index < descriptor.count; index += 1) {
            key = descriptor.getKey(index); result[typeName(key)] = convertValue(descriptor, key);
        }
        return result;
    }
    function layerDescriptor(documentId, id) {
        var reference = new ActionReference();
        reference.putIdentifier(sid('layer'), Number(id));
        reference.putIdentifier(sid('document'), Number(documentId));
        return executeActionGet(reference);
    }
    function documentProperty(documentId, property) {
        var reference = new ActionReference();
        reference.putProperty(sid('property'), sid(property));
        reference.putIdentifier(sid('document'), Number(documentId));
        return executeActionGet(reference);
    }
    function findDocument(id) {
        for (var index = 0; index < app.documents.length; index += 1) {
            if (String(app.documents[index].id) === String(id)) { return app.documents[index]; }
        }
        return null;
    }
    function requireDocument(id) {
        if (id == null || String(id) === '') { fail('documentId is required.', 'PSD2UI_DOCUMENT_ID_REQUIRED'); }
        var document = findDocument(id);
        if (!document) { fail('Photoshop document ' + id + ' is not open.', 'PSD2UI_DOCUMENT_NOT_FOUND'); }
        return document;
    }
    function activeId() { return app.documents.length ? app.activeDocument.id : null; }
    function openDocumentIds() {
        var ids = {};
        for (var index = 0; index < app.documents.length; index += 1) { ids[String(app.documents[index].id)] = true; }
        return ids;
    }
    function activate(document) { if (String(activeId()) !== String(document.id)) { app.activeDocument = document; } }
    function restoreActive(id) { var document = findDocument(id); if (document) { activate(document); } }
    function findLayer(layers, id) {
        for (var index = 0; index < layers.length; index += 1) {
            if (String(layers[index].id) === String(id)) { return layers[index]; }
            if (layers[index].typename === 'LayerSet') {
                var child = findLayer(layers[index].layers, id); if (child) { return child; }
            }
        }
        return null;
    }
    function requireLayer(document, id, context) {
        var documentKey = String(document.id), layerKey = String(id), lookup = layerLookups[documentKey];
        if (lookup && has(lookup, layerKey)) {
            try {
                var cached = lookup[layerKey](), owner = cached;
                while (owner && owner.typename !== 'Document') { owner = owner.parent; }
                if (String(cached.id) === layerKey && owner && String(owner.id) === documentKey) { return cached; }
            } catch (staleLayer) {}
            delete lookup[layerKey];
        }
        var layer = findLayer(document.layers, id);
        if (!layer) { fail('Layer ' + id + ' is not in document ' + document.id + '.' + (context ? ' (' + context + ')' : ''), 'PSD2UI_LAYER_NOT_FOUND'); }
        if (!lookup) { lookup = {}; layerLookups[documentKey] = lookup; }
        lookup[layerKey] = function () { return layer; };
        return layer;
    }
    function documentPath(document) {
        try { return String(document.fullName.fsName); } catch (unsaved) { return ''; }
    }
    function selectionIds(document) {
        var result = [], descriptor, list, index, reference, layerIndex, layerRef;
        try {
            descriptor = documentProperty(document.id, 'targetLayersIDs');
            if (descriptor.hasKey(sid('targetLayersIDs'))) {
                list = descriptor.getList(sid('targetLayersIDs'));
                for (index = 0; index < list.count; index += 1) { result.push(list.getReference(index).getIdentifier()); }
                return result;
            }
        } catch (oldHost) {}
        try {
            descriptor = documentProperty(document.id, 'targetLayers');
            if (descriptor.hasKey(sid('targetLayers'))) {
                list = descriptor.getList(sid('targetLayers'));
                var backgroundOffset = 1;
                try { document.backgroundLayer; backgroundOffset = 0; } catch (noBackground) {}
                for (index = 0; index < list.count; index += 1) {
                    reference = list.getReference(index); layerIndex = reference.getIndex() + backgroundOffset;
                    layerRef = new ActionReference(); layerRef.putIndex(sid('layer'), layerIndex);
                    layerRef.putIdentifier(sid('document'), Number(document.id));
                    result.push(executeActionGet(layerRef).getInteger(sid('layerID')));
                }
                return result;
            }
        } catch (selectionError) {
            fail('Cannot read Photoshop layer selection: ' + selectionError.message, 'PSD2UI_SELECTION_READ_FAILED');
        }
        // Some old hosts omit targetLayers for one selected layer. A missing activeLayer
        // means a genuinely empty selection and must stay empty.
        try { if (document.activeLayer) { result.push(document.activeLayer.id); } } catch (empty) {}
        return result;
    }
    var blendNames = {
        NORMAL: 'normal', PASSTHROUGH: 'passThrough', DISSOLVE: 'dissolve', DARKEN: 'darken', MULTIPLY: 'multiply',
        COLORBURN: 'colorBurn', LINEARBURN: 'linearBurn', DARKERCOLOR: 'darkerColor', LIGHTEN: 'lighten', SCREEN: 'screen',
        COLORDODGE: 'colorDodge', LINEARDODGE: 'linearDodge', LIGHTERCOLOR: 'lighterColor', OVERLAY: 'overlay',
        SOFTLIGHT: 'softLight', HARDLIGHT: 'hardLight', VIVIDLIGHT: 'vividLight', LINEARLIGHT: 'linearLight',
        PINLIGHT: 'pinLight', HARDMIX: 'hardMix', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', SUBTRACT: 'subtract',
        DIVIDE: 'divide', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity'
    };
    function blendName(value) { var key = String(value).replace(/^.*\./, '').toUpperCase(); return has(blendNames, key) ? blendNames[key] : String(value); }
    function blendValue(value) {
        var name = String(value), key;
        for (key in blendNames) { if (has(blendNames, key) && (name === blendNames[key] || name.toUpperCase() === key || name === 'BlendMode.' + key)) { return BlendMode[key]; } }
        fail('Unsupported blend mode ' + name + '.', 'PSD2UI_BLEND_MODE_UNSUPPORTED');
    }
    function kindName(layer) {
        if (layer.typename === 'LayerSet') { return 'group'; }
        var kind = String(layer.kind).replace(/^.*\./, '').toUpperCase();
        var names = { TEXT: 'text', NORMAL: 'pixel', SMARTOBJECT: 'smartObject', SOLIDFILL: 'solidFill', GRADIENTFILL: 'gradientFill', PATTERNFILL: 'patternFill' };
        return has(names, kind) ? names[kind] : kind.toLowerCase();
    }
    function textPixels(value, resolution) {
        // ExtendScript's UnitValue.as('px') assumes 72 ppi unless baseUnit is changed.
        // Font units are points; use document resolution without changing global units.
        var points = value && typeof value.as === 'function' ? value.as('pt') : value;
        return finite(points, 'Text point value') * Number(resolution) / 72;
    }
    function readTextItem(layer, document) {
        var item = layer.textItem, size = null, leading = null, rgb = null, justification = 'left', kind;
        try { size = textPixels(item.size, document.resolution); } catch (sizeUnavailable) {}
        try { leading = textPixels(item.leading, document.resolution); } catch (leadingUnavailable) {}
        try { var color = item.color.rgb; rgb = { red: Number(color.red), green: Number(color.green), blue: Number(color.blue) }; } catch (colorUnavailable) {}
        try { justification = String(item.justification).replace(/^.*\./, '').toLowerCase(); } catch (alignmentUnavailable) {}
        kind = String(item.kind).replace(/^.*\./, '').toUpperCase();
        return { contents: String(item.contents), characterStyle: { size: size, leading: leading, color: rgb ? { rgb: rgb } : null },
            paragraphStyle: { justification: justification }, isPointText: kind === 'POINTTEXT', isParagraphText: kind === 'PARAGRAPHTEXT' };
    }
    function readLayer(document, layer, shallow) {
        var descriptor = convertDescriptor(layerDescriptor(document.id, layer.id)), children = [], index;
        function descriptorBounds(raw) {
            if (!raw || !raw.left || !raw.top || !raw.right || !raw.bottom) { return null; }
            return { left: Number(raw.left._value), top: Number(raw.top._value), right: Number(raw.right._value), bottom: Number(raw.bottom._value) };
        }
        var area = null;
        if (layer.typename !== 'LayerSet') { area = descriptorBounds(descriptor.bounds); }
        if (!area) { area = bounds(layer.bounds); }
        var noEffects = descriptorBounds(descriptor.boundsNoEffects);
        if (!noEffects) { try { noEffects = bounds(layer.boundsNoEffects); } catch (noDomBounds) { noEffects = area; } }
        if (!shallow && layer.typename === 'LayerSet') { for (index = 0; index < layer.layers.length; index += 1) { children.push(readLayer(document, layer.layers[index])); } }
        var kind = kindName(layer), clipped = descriptor.group === true;
        if (!has(descriptor, 'group')) { try { clipped = layer.grouped === true; } catch (noGrouped) {} }
        return { id: layer.id, name: String(descriptor.name == null ? layer.name : descriptor.name), kind: kind, bounds: area, boundsNoEffects: noEffects,
            visible: has(descriptor, 'visible') ? Boolean(descriptor.visible) : Boolean(layer.visible),
            opacity: typeof descriptor.opacity === 'number' ? descriptor.opacity * 100 / 255 : Number(layer.opacity),
            blendMode: descriptor.mode && descriptor.mode._value ? descriptor.mode._value : blendName(layer.blendMode),
            clipped: clipped, hasLayerMask: descriptor.hasUserMask === true, hasVectorMask: descriptor.hasVectorMask === true,
            textItem: kind === 'text' ? readTextItem(layer, document) : null, descriptor: descriptor, layers: children };
    }
    function state() {
        var output = { activeDocumentId: activeId(), documents: [], version: String(app.version) }, index, layerIndex, document, layers;
        for (index = 0; index < app.documents.length; index += 1) {
            document = app.documents[index]; layers = [];
            for (layerIndex = 0; layerIndex < document.layers.length; layerIndex += 1) { layers.push(readLayer(document, document.layers[layerIndex])); }
            output.documents.push({ id: document.id, title: String(document.name), name: String(document.name), path: documentPath(document),
                width: pixels(document.width), height: pixels(document.height), resolution: Number(document.resolution), layers: layers,
                activeLayerIds: selectionIds(document) });
        }
        return output;
    }
    function probe() {
        var output = { activeDocumentId: activeId(), documents: [], version: String(app.version) }, index;
        for (index = 0; index < app.documents.length; index += 1) {
            var document = app.documents[index], reference = new ActionReference();
            reference.putEnumerated(sid('historyState'), sid('ordinal'), sid('targetEnum'));
            reference.putIdentifier(sid('document'), Number(document.id));
            var history = executeActionGet(reference);
            output.documents.push({ id: document.id, title: String(document.name), name: String(document.name), path: documentPath(document),
                width: pixels(document.width), height: pixels(document.height), resolution: Number(document.resolution),
                activeLayerIds: selectionIds(document), historyId: history.getInteger(sid('ID')) });
        }
        return output;
    }
    function sameDocumentContent(left, right) {
        var keys = ['id', 'title', 'name', 'path', 'width', 'height', 'resolution', 'historyId'], index;
        for (index = 0; index < keys.length; index += 1) {
            if (left[keys[index]] !== right[keys[index]]) { return false; }
        }
        return true;
    }
    function beginState(params) {
        var stamp = probe(), frames = [], reused = [], index, previous, known = (params || {}).knownDocuments || [];
        var open = {}, key;
        for (index = 0; index < stamp.documents.length; index += 1) { open[String(stamp.documents[index].id)] = true; }
        for (key in layerLookups) { if (has(layerLookups, key) && !has(open, key)) { delete layerLookups[key]; } }
        for (index = app.documents.length - 1; index >= 0; index -= 1) {
            var document = app.documents[index];
            var unchanged = false;
            for (previous = 0; previous < known.length; previous += 1) {
                if (sameDocumentContent(stamp.documents[index], known[previous])) { unchanged = true; break; }
            }
            if (unchanged) { reused.push(document.id); continue; }
            layerLookups[String(document.id)] = {};
            var count = documentProperty(document.id, 'numberOfLayers').getInteger(sid('numberOfLayers')), minimum = 1;
            try { document.backgroundLayer; minimum = 0; } catch (noBackground) {}
            frames.push({ document: document, parents: [], root: { layers: document.layers, index: 0 },
                index: count, minimum: minimum, resolution: Number(document.resolution) });
        }
        stateRead = { token: uid('Read'), stamp: stringifyJson(stamp), frames: frames };
        return { token: stateRead.token, stamp: stamp, reusedDocumentIds: reused };
    }
    function indexedTextItem(text, resolution) {
        var ranges = text && text.textStyleRange, paragraphs = text && text.paragraphStyleRange, shapes = text && text.textShape;
        if (!ranges || !ranges.length || !shapes || !shapes.length) { return null; }
        var style = ranges[0].textStyle || {}, paragraph = {}, index;
        if (paragraphs && paragraphs.length) { paragraph = paragraphs[0].paragraphStyle || {}; }
        function inherited(source, key) {
            for (var depth = 0; source && depth < 16; depth += 1) {
                if (has(source, key)) { return source[key]; } source = source.baseParentStyle;
            }
            return null;
        }
        function measure(value) {
            if (!value) { return null; }
            if (value._unit === 'pixelsUnit') { return Number(value._value); }
            if (value._unit === 'pointsUnit') { return Number(value._value) * resolution / 72; }
            return null;
        }
        var color = inherited(style, 'color'), shape = shapes[0].char, point = shape && shape._value === 'paint';
        if (!color || color._obj !== 'RGBColor' || !shape || (shape._value !== 'paint' && shape._value !== 'box')) { return null; }
        for (index = 1; index < shapes.length; index += 1) { if (!shapes[index].char || shapes[index].char._value !== shape._value) { return null; } }
        var size = measure(inherited(style, 'size')), align = inherited(paragraph, 'align');
        if (size == null) { return null; }
        var justification = align ? align._value : 'left';
        var justified = { justifyLeft: 'leftjustified', justifyCenter: 'centerjustified', justifyRight: 'rightjustified', justifyAll: 'fullyjustified' };
        if (has(justified, justification)) { justification = justified[justification]; }
        return { contents: String(text.textKey || ''), characterStyle: { size: size, leading: measure(inherited(style, 'leading')),
            color: { rgb: { red: Number(color.red), green: Number(color.grain == null ? color.green : color.grain), blue: Number(color.blue) } } },
            paragraphStyle: { justification: justification }, isPointText: point, isParagraphText: !point };
    }
    function indexedLayer(frame, descriptor, section, resolveLayer) {
        var kind = null, textItem = null, number = Number(descriptor.layerKind);
        if (section === 'layerSectionStart') { kind = 'group'; }
        else if (number === 3 || descriptor.textKey) { kind = 'text'; }
        else if (number === 1 || number === 12) { kind = 'pixel'; }
        else if (number === 5) { kind = 'smartObject'; }
        else if (number === 9) { kind = 'gradientFill'; }
        else if (number === 10) { kind = 'patternFill'; }
        else if (number === 4 || number === 11) {
            var adjustment = descriptor.adjustment && descriptor.adjustment[0];
            if (adjustment && (adjustment._obj === 'solidColorLayer' || adjustment._obj === 'gradientLayer' || adjustment._obj === 'patternLayer')) {
                var fillKinds = { solidColorLayer: 'solidFill', gradientLayer: 'gradientFill', patternLayer: 'patternFill' };
                kind = fillKinds[adjustment._obj];
            }
        }
        function area(raw) {
            if (!raw || !raw.left || !raw.top || !raw.right || !raw.bottom) { return null; }
            return { left: Number(raw.left._value), top: Number(raw.top._value), right: Number(raw.right._value), bottom: Number(raw.bottom._value) };
        }
        var boundsValue = area(descriptor.bounds), noEffects = area(descriptor.boundsNoEffects);
        // Rare adjustment/color-model/older-host cases retain the original DOM
        // projection. Do not invent approximations to make the fast path pass.
        if (!kind || !boundsValue || !noEffects || typeof descriptor.opacity !== 'number' || !descriptor.mode) {
            return readLayer(frame.document, resolveLayer(), true);
        }
        // AM reports the canvas rectangle for some LayerSet bounds. Keep DOM
        // rendered group bounds, using the known parent/child position (no ID scan).
        if (kind === 'group') { boundsValue = bounds(resolveLayer().bounds); }
        if (kind === 'text') {
            textItem = indexedTextItem(descriptor.textKey, frame.resolution);
            if (!textItem) { textItem = readTextItem(resolveLayer(), frame.document); }
        }
        return { id: descriptor.layerID, name: String(descriptor.name), kind: kind, bounds: boundsValue, boundsNoEffects: noEffects,
            visible: descriptor.visible !== false, opacity: descriptor.opacity * 100 / 255, blendMode: descriptor.mode._value,
            clipped: descriptor.group === true, hasLayerMask: descriptor.hasUserMask === true, hasVectorMask: descriptor.hasVectorMask === true,
            textItem: textItem, descriptor: descriptor, layers: [] };
    }
    function snapshotDescriptor(raw) {
        // Shared photoshopDocument.js exports full AM parameters only for text.
        // Other layers need identity/geometry/protection; their pixels and effects
        // are rendered by Photoshop during export, not reconstructed from JSON.
        if (raw.hasKey(sid('textKey'))) { return convertDescriptor(raw); }
        var names = ['layerID', 'name', 'layerKind', 'layerSection', 'bounds', 'boundsNoEffects', 'visible', 'opacity', 'mode', 'group', 'hasUserMask', 'hasVectorMask'];
        var output = {}, index, key;
        for (index = 0; index < names.length; index += 1) {
            key = sid(names[index]); if (raw.hasKey(key)) { output[names[index]] = convertValue(raw, key); }
        }
        if (raw.hasKey(sid('adjustment'))) {
            var adjustments = raw.getList(sid('adjustment'));
            if (adjustments.count) { output.adjustment = [{ _obj: typeName(adjustments.getObjectType(0)) }]; }
        }
        return output;
    }
    function layerResolver(parent, index, expectedId) {
        var cached = null;
        return function () {
            if (!cached) {
                cached = parent.layers[index];
                if (!cached || String(cached.id) !== String(expectedId)) { fail('Native and DOM layer order differ.', 'PSD2UI_STATE_TREE_INVALID'); }
            }
            return cached;
        };
    }
    function statePage(params) {
        if (!stateRead || stateRead.token !== params.token) { fail('State read expired; refresh the panel.', 'PSD2UI_STATE_READ_EXPIRED'); }
        var scan = stateRead, items = [], started = new Date().getTime();
        function checkStamp() {
            if (stringifyJson(probe()) !== scan.stamp) {
                stateRead = null;
                fail('Document changed during state read; refresh after finishing the edit.', 'PSD2UI_STATE_CHANGED');
            }
        }
        checkStamp();
        // Return to CEP frequently so Photoshop can process input between pages.
        // Publish no partial tree: the panel assembles and commits the final page.
        while (scan.frames.length && items.length < 8 && new Date().getTime() - started < 80) {
            var frame = scan.frames[scan.frames.length - 1];
            if (frame.index < frame.minimum) {
                if (frame.parents.length) { fail('Layer group markers are unbalanced.', 'PSD2UI_STATE_TREE_INVALID'); }
                scan.frames.pop(); continue;
            }
            var reference = new ActionReference();
            reference.putIndex(sid('layer'), frame.index--); reference.putIdentifier(sid('document'), Number(frame.document.id));
            var raw = executeActionGet(reference), section = typeName(raw.getEnumerationValue(sid('layerSection')));
            if (section === 'layerSectionEnd') {
                if (!frame.parents.length) { fail('Unexpected layer group end.', 'PSD2UI_STATE_TREE_INVALID'); }
                frame.parents.pop(); continue;
            }
            var parent = frame.root, parentId = null, descriptor = snapshotDescriptor(raw);
            if (frame.parents.length) { parent = frame.parents[frame.parents.length - 1]; parentId = parent.id; }
            var resolveLayer = layerResolver(parent, parent.index++, descriptor.layerID);
            // Resolve lazily from the already verified tree position. Walking all
            // preceding DOM layers again for each exported image is quadratic.
            layerLookups[String(frame.document.id)][String(descriptor.layerID)] = resolveLayer;
            var data = indexedLayer(frame, descriptor, section, resolveLayer);
            items.push({ documentId: frame.document.id, parentId: parentId, layer: data });
            if (section === 'layerSectionStart') { frame.parents.push({ id: data.id, layers: resolveLayer().layers, index: 0 }); }
        }
        checkStamp();
        var done = scan.frames.length === 0;
        if (done) { stateRead = null; }
        return { items: items, done: done };
    }
    function select(document, ids, add) {
        if (!ids || !ids.length) { fail('At least one layerId is required.', 'PSD2UI_EMPTY_SELECTION'); }
        var combined = add ? selectionIds(document) : [], index, candidate, found, second;
        for (index = 0; index < ids.length; index += 1) {
            candidate = requireLayer(document, ids[index]).id; found = false;
            for (second = 0; second < combined.length; second += 1) { if (String(combined[second]) === String(candidate)) { found = true; break; } }
            if (!found) { combined.push(candidate); }
        }
        activate(document);
        for (index = 0; index < combined.length; index += 1) {
            var descriptor = new ActionDescriptor(), reference = new ActionReference();
            reference.putIdentifier(sid('layer'), Number(combined[index])); descriptor.putReference(cid('null'), reference);
            if (index > 0) { descriptor.putEnumerated(sid('selectionModifier'), sid('selectionModifierType'), sid('addToSelection')); }
            descriptor.putBoolean(sid('makeVisible'), false); executeAction(sid('select'), descriptor, DialogModes.NO);
        }
    }
    function getXmp(document) { return String(document.xmpMetadata.rawData || ''); }
    function xmpLibrary() {
        if (typeof ExternalObject === 'undefined') { fail('AdobeXMPScript is unavailable.', 'PSD2UI_XMP_UNAVAILABLE'); }
        if (!ExternalObject.AdobeXMPScript) { ExternalObject.AdobeXMPScript = new ExternalObject('lib:AdobeXMPScript'); }
        XMPMeta.registerNamespace(namespaceUri, namespacePrefix);
    }
    function requireTemporary(document) {
        var id = String(document.id), path = documentPath(document), name = String(document.name);
        if (has(temporaryDocuments, id) || (!path && (name === 'PSD2UI_Resource_Workbench' || name === 'PSD2UI_NineSlice_Output'))) { return; }
        fail('Refusing to close or replace pixels in an unowned document ' + id + ': ' + name, 'PSD2UI_DOCUMENT_NOT_TEMPORARY');
    }
    function closeTemporary(document) {
        requireTemporary(document); var id = document.id, previous = activeId();
        activate(document); document.close(SaveOptions.DONOTSAVECHANGES);
        if (findDocument(id)) { fail('Temporary document did not close.', 'PSD2UI_DOCUMENT_CLOSE_FAILED'); }
        delete temporaryDocuments[String(id)]; restoreActive(previous);
    }
    function snapshotReference(name) { var reference = new ActionReference(); reference.putName(cid('SnpS'), name); return reference; }
    function snapshotAction(action, name) {
        var descriptor = new ActionDescriptor(); descriptor.putReference(cid('null'), snapshotReference(name));
        executeAction(cid(action), descriptor, DialogModes.NO);
    }
    function savePng(document, path, compression) {
        activate(document);
        // PNGSaveOptions does not expose ICC embedding. Use the save action's
        // embedProfiles flag instead of setting an ignored property on DOM options.
        var descriptor = new ActionDescriptor(), options = new ActionDescriptor();
        options.putEnumerated(sid('PNGInterlaceType'), sid('PNGInterlaceType'), sid('PNGInterlaceNone'));
        options.putEnumerated(sid('PNGFilter'), sid('PNGFilter'), sid('PNGFilterAdaptive'));
        options.putInteger(sid('compression'), compression == null ? 6 : Math.max(0, Math.min(9, finite(compression, 'compression'))));
        descriptor.putObject(cid('As  '), sid('PNGFormat'), options);
        descriptor.putPath(cid('In  '), new File(nativePath(path)));
        descriptor.putInteger(cid('DocI'), Number(document.id));
        descriptor.putBoolean(cid('Cpy '), true);
        descriptor.putBoolean(cid('LwCs'), true);
        descriptor.putBoolean(sid('embedProfiles'), true);
        executeAction(cid('save'), descriptor, DialogModes.NO);
    }
    function assignProfile(document, profile) {
        activate(document);
        var descriptor = new ActionDescriptor(), reference = new ActionReference();
        reference.putIdentifier(sid('document'), Number(document.id)); descriptor.putReference(cid('null'), reference);
        descriptor.putString(sid('profile'), profile); descriptor.putBoolean(sid('manage'), true);
        executeAction(sid('assignProfile'), descriptor, DialogModes.NO);
        if (String(document.colorProfileName) !== String(profile)) { fail('Assigned color profile does not match.', 'PSD2UI_PROFILE_ASSIGN_FAILED'); }
    }
    function descendantsContain(layer, candidate) {
        var current = candidate;
        while (current && current.typename !== 'Document') {
            if (String(current.id) === String(layer.id)) { return true; } current = current.parent;
        }
        return false;
    }
    function preserveBounds(layer, before) {
        var after = bounds(layer.bounds), dx = before.left - after.left, dy = before.top - after.top;
        if (Math.abs((before.right - before.left) - (after.right - after.left)) > 0.01 || Math.abs((before.bottom - before.top) - (after.bottom - after.top)) > 0.01) {
            fail('Moving a layer changed its rendered bounds size.', 'PSD2UI_MOVE_BOUNDS_CHANGED');
        }
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) { layer.translate(px(dx), px(dy)); }
        after = bounds(layer.bounds);
        if (Math.abs(after.left - before.left) > 0.01 || Math.abs(after.top - before.top) > 0.01 || Math.abs(after.right - before.right) > 0.01 || Math.abs(after.bottom - before.bottom) > 0.01) {
            fail('Could not preserve absolute layer bounds.', 'PSD2UI_MOVE_BOUNDS_CHANGED');
        }
    }
    var methods = {};
    methods.state = function () { return state(); };
    methods.probe = function () { return probe(); };
    methods.notificationEvents = function () {
        var names = ['select', 'open', 'close', 'make', 'delete', 'set', 'move', 'transform',
            'show', 'hide', 'undo', 'redo', 'historyStateChanged'], ids = [], index;
        for (index = 0; index < names.length; index += 1) { ids.push(sid(names[index])); }
        return ids;
    };
    methods.beginState = function (params) { return beginState(params); };
    methods.statePage = statePage;
    methods.open = function (params) {
        var file = new File(nativePath(params.path)), requested = normalizedPath(file.fsName), index, document;
        for (index = 0; index < app.documents.length; index += 1) {
            document = app.documents[index];
            if (normalizedPath(documentPath(document)) === requested) { activate(document); return { id: document.id, documentId: document.id }; }
        }
        if (!file.exists) { fail('File does not exist: ' + file.fsName, 'PSD2UI_FILE_NOT_FOUND'); }
        var knownIds = openDocumentIds(); document = app.open(file);
        if (normalizedPath(documentPath(document)) !== requested) { fail('Opened document path does not match request.', 'PSD2UI_DOCUMENT_PATH_MISMATCH'); }
        if (/\.png$/i.test(file.fsName) && !has(knownIds, String(document.id))) { temporaryDocuments[String(document.id)] = 'opened-png'; }
        return { id: document.id, documentId: document.id };
    };
    methods.activate = function (params) { activate(requireDocument(docId(params))); return null; };
    methods.addDocument = function (params) {
        var width = finite(params.width, 'width'), height = finite(params.height, 'height'), resolution = params.resolution == null ? 72 : finite(params.resolution, 'resolution');
        if (width <= 0 || height <= 0 || resolution <= 0) { fail('Document dimensions and resolution must be positive.', 'PSD2UI_INVALID_ARGUMENT'); }
        if (params.depth != null && Number(params.depth) !== 8) { fail('Only 8-bit temporary documents are supported.', 'PSD2UI_UNSUPPORTED_DEPTH'); }
        if (params.mode != null && !/^(RGB|RGBColorMode)$/i.test(params.mode)) { fail('Only RGB temporary documents are supported.', 'PSD2UI_UNSUPPORTED_COLOR_MODE'); }
        if (params.fill != null && String(params.fill).toLowerCase() !== 'transparent') { fail('Temporary documents must use transparent fill.', 'PSD2UI_UNSUPPORTED_FILL'); }
        var document = app.documents.add(px(width), px(height), resolution, text(params.name, 'name'), NewDocumentMode.RGB, DocumentFill.TRANSPARENT, 1, BitsPerChannelType.EIGHT);
        temporaryDocuments[String(document.id)] = 'created'; return { id: document.id, documentId: document.id };
    };
    methods.select = function (params) { select(requireDocument(docId(params)), params.layerIds || params.layerIDs, params.add === true); return null; };
    methods.setLayer = function (params) {
        var document = requireDocument(docId(params)), layer = requireLayer(document, layerId(params)), values = params.values || params, key;
        if (params.values) { for (key in values) { if (has(values, key) && key !== 'name' && key !== 'visible' && key !== 'blendMode' && key !== 'opacity') { fail('Unsupported layer property: ' + key, 'PSD2UI_UNSUPPORTED_LAYER_PROPERTY'); } } }
        var nextName = has(values, 'name') ? text(values.name, 'name') : null;
        var nextBlend = has(values, 'blendMode') ? blendValue(values.blendMode) : null;
        var opacity = has(values, 'opacity') ? finite(values.opacity, 'opacity') : null;
        if (opacity != null && (opacity < 0 || opacity > 100)) { fail('Opacity must be in 0..100.', 'PSD2UI_INVALID_ARGUMENT'); }
        activate(document);
        if (has(values, 'name')) { layer.name = nextName; }
        if (has(values, 'visible')) { layer.visible = Boolean(values.visible); }
        if (has(values, 'blendMode')) { layer.blendMode = nextBlend; }
        if (has(values, 'opacity')) { layer.opacity = opacity; }
        return null;
    };
    methods.group = function (params) {
        var document = requireDocument(docId(params)), ids = params.layerIds || params.layerIDs, index, layer, parent, selected = {}, before = [], expected = [], first = -1, last = -1;
        if (!ids || !ids.length) { fail('group requires layerIds.', 'PSD2UI_EMPTY_SELECTION'); }
        for (index = 0; index < ids.length; index += 1) {
            layer = requireLayer(document, ids[index]); if (has(selected, String(layer.id))) { fail('Duplicate group member.', 'PSD2UI_DUPLICATE_LAYER'); }
            selected[String(layer.id)] = true;
            if (!parent) { parent = layer.parent; } else if (parent !== layer.parent && (parent.typename !== layer.parent.typename || String(parent.id) !== String(layer.parent.id))) { fail('Group members must share a parent.', 'PSD2UI_GROUP_PARENT_MISMATCH'); }
        }
        for (index = 0; index < parent.layers.length; index += 1) {
            layer = parent.layers[index]; before.push(String(layer.id));
            if (has(selected, String(layer.id))) { if (first < 0) { first = index; } last = index; expected.push(String(layer.id)); }
        }
        if (last - first + 1 !== ids.length) { fail('Group members must be contiguous to preserve stacking order.', 'PSD2UI_NONCONTIGUOUS_GROUP'); }
        select(document, expected, false);
        var descriptor = new ActionDescriptor(), reference = new ActionReference(), from = new ActionReference();
        reference.putClass(sid('layerSection')); descriptor.putReference(cid('null'), reference);
        from.putEnumerated(sid('layer'), sid('ordinal'), sid('targetEnum')); descriptor.putReference(cid('From'), from);
        executeAction(sid('make'), descriptor, DialogModes.NO);
        var group = document.activeLayer;
        if (!group || group.typename !== 'LayerSet') { fail('Photoshop did not create a layer group.', 'PSD2UI_GROUP_CREATE_FAILED'); }
        group.name = text(params.name, 'name'); group.blendMode = BlendMode.PASSTHROUGH;
        if (group.layers.length !== expected.length) { fail('Group membership changed.', 'PSD2UI_GROUP_ORDER_CHANGED'); }
        for (index = 0; index < expected.length; index += 1) { if (String(group.layers[index].id) !== expected[index]) { fail('Grouping changed member order.', 'PSD2UI_GROUP_ORDER_CHANGED'); } }
        return { id: group.id, layerId: group.id };
    };
    methods.duplicate = function (params) {
        var document = requireDocument(docId(params)), layer = requireLayer(document, layerId(params)), targetId = identifier(params, 'targetDocumentId', 'targetDocumentID'), copy;
        activate(document);
        if (targetId != null) {
            var target = requireDocument(targetId), placement = String(params.placement || 'PLACEATBEGINNING').replace(/^.*\./, '').replace(/[^a-z]/gi, '').toUpperCase();
            if (placement !== 'PLACEATBEGINNING' && placement !== 'PLACEATEND') { fail('Unsupported duplicate placement.', 'PSD2UI_UNSUPPORTED_PLACEMENT'); }
            copy = layer.duplicate(target, ElementPlacement[placement]);
        } else { copy = layer.duplicate(); }
        return { id: copy.id, layerId: copy.id };
    };
    methods.translate = function (params) {
        var document = requireDocument(docId(params)), layer = requireLayer(document, layerId(params)); activate(document);
        layer.translate(px(params.offsetX != null ? params.offsetX : params.x), px(params.offsetY != null ? params.offsetY : params.y)); return null;
    };
    methods.trim = function (params) { var document = requireDocument(docId(params)); requireTemporary(document); activate(document); document.trim(TrimType.TRANSPARENT, true, true, true, true); return null; };
    methods.save = function (params) { var document = requireDocument(docId(params)); if (!documentPath(document)) { fail('Save requires a local document path.', 'PSD2UI_LOCAL_PATH_REQUIRED'); } activate(document); document.save(); return null; };
    methods.savePng = function (params) { savePng(requireDocument(docId(params)), params.path, params.compression != null ? params.compression : (params.options || {}).compression); return null; };
    methods.close = function (params) { closeTemporary(requireDocument(docId(params))); return null; };
    methods.getXmp = function (params) { return getXmp(requireDocument(docId(params))); };
    methods.setXmp = function (params) {
        var document = requireDocument(docId(params)), raw = params.raw || '';
        if (params.rawXmp != null) { raw = params.rawXmp; }
        else if (params.xmp != null) { raw = params.xmp; }
        activate(document); document.xmpMetadata.rawData = String(raw); return null;
    };
    methods.readManifest = function (params) {
        var raw = getXmp(requireDocument(docId(params))); if (!raw) { return null; }
        xmpLibrary(); var xmp = new XMPMeta(raw), property = xmp.getProperty(namespaceUri, propertyName);
        if (!property || !property.value) { return null; }
        // CEP has native JSON.parse. Parsing a megabyte manifest in ES3 on every
        // selection stalls Photoshop's UI; transport the string without walking it.
        if (params.serialized === true) { return String(property.value); }
        return parseJson(String(property.value));
    };
    methods.writeManifest = function (params) {
        if ((params.namespaceUri && params.namespaceUri !== namespaceUri) || (params.namespacePrefix && params.namespacePrefix !== namespacePrefix) || (params.propertyName && params.propertyName !== propertyName)) {
            fail('Manifest namespace does not match PSD2UI.', 'PSD2UI_XMP_NAMESPACE_MISMATCH');
        }
        var document = requireDocument(docId(params)), serialized = params.serializedManifest != null ? String(params.serializedManifest) : stringifyJson(params.manifest);
        var parsed = parseJson(serialized); if (!parsed || typeof parsed !== 'object') { fail('Manifest must be a JSON object.', 'PSD2UI_INVALID_MANIFEST'); }
        xmpLibrary(); var raw = getXmp(document), xmp = raw ? new XMPMeta(raw) : new XMPMeta();
        xmp.setProperty(namespaceUri, propertyName, serialized); activate(document); document.xmpMetadata.rawData = xmp.serialize();
        var verified = new XMPMeta(getXmp(document)).getProperty(namespaceUri, propertyName);
        if (!verified || String(verified.value) !== serialized) { fail('Manifest XMP readback does not match.', 'PSD2UI_XMP_READBACK_FAILED'); }
        return null;
    };
    methods.beginHistory = function (params) {
        var document = requireDocument(docId(params)), id = uid('History'), name = id + '_' + String(params.name || 'Command'), descriptor = new ActionDescriptor(), reference = new ActionReference(), from = new ActionReference();
        activate(document);
        // ExtendScript can expose the preceding history state until Photoshop has
        // processed its update (especially when multiple commands share one JSX).
        app.refresh();
        reference.putClass(cid('SnpS')); descriptor.putReference(cid('null'), reference);
        from.putProperty(cid('HstS'), cid('CrnH')); descriptor.putReference(cid('From'), from); descriptor.putString(cid('Nm  '), name);
        descriptor.putEnumerated(cid('Usng'), cid('HstS'), cid('FllD'));
        executeAction(cid('Mk  '), descriptor, DialogModes.NO);
        historyTokens[id] = { id: id, documentId: document.id, snapshotName: name };
        return { id: id, documentId: document.id };
    };
    methods.endHistory = function (params) {
        var id = String(params.token && params.token.id || params.token || ''), token = historyTokens[id];
        if (!token) { fail('History token is missing or already closed.', 'PSD2UI_HISTORY_TOKEN_INVALID'); }
        if (params.token && params.token.documentId != null && String(params.token.documentId) !== String(token.documentId)) { fail('History token document does not match.', 'PSD2UI_HISTORY_TOKEN_INVALID'); }
        activate(requireDocument(token.documentId));
        if (params.commit === false) {
            snapshotAction('slct', token.snapshotName);
            // Deleting the currently selected recovery snapshot can move Photoshop
            // back to an earlier history state. Retain it until the document closes.
            // The token is consumed; retaining this named snapshot is intentional.
            delete historyTokens[id];
            return { restored: true, snapshotRetained: true, recoverySnapshot: token.snapshotName };
        }
        // Keep the token/snapshot if commit cleanup fails, so recovery can be retried.
        snapshotAction('Dlt ', token.snapshotName); delete historyTokens[id]; return null;
    };
    methods.exportPixels = function (params) {
        var source = requireDocument(docId(params)), previous = activeId(), knownIds = openDocumentIds(), copy = null, copyId = null, result;
        try {
            activate(source); copy = source.duplicate(uid('Pixels'), false);
            if (has(knownIds, String(copy.id))) { fail('Pixel export did not create an independent document.', 'PSD2UI_TEMP_DOCUMENT_CREATE_FAILED'); }
            copyId = copy.id;
            temporaryDocuments[String(copyId)] = 'pixel-export'; activate(copy);
            if (copy.mode !== DocumentMode.RGB) { copy.changeMode(ChangeMode.RGB); }
            if (copy.bitsPerChannel !== BitsPerChannelType.EIGHT) { copy.bitsPerChannel = BitsPerChannelType.EIGHT; }
            if (params.colorProfile) { copy.convertProfile(String(params.colorProfile), Intent.RELATIVECOLORIMETRIC, true, false); }
            var profile = ''; try { profile = String(copy.colorProfileName || ''); } catch (profileUnavailable) {}
            savePng(copy, params.path, 6);
            result = { path: nativePath(params.path), colorProfile: profile, colorSpace: 'RGB', width: pixels(copy.width), height: pixels(copy.height) };
        } finally {
            if (copyId != null && String(copyId) !== String(source.id) && findDocument(copyId)) { closeTemporary(requireDocument(copyId)); }
            restoreActive(previous);
        }
        return result;
    };
    methods.importPixels = function (params) {
        var target = requireDocument(docId(params)), oldLayer = requireLayer(target, layerId(params)), previous = activeId(), file = new File(nativePath(params.path)), opened = null, openedId = null, index;
        requireTemporary(target);
        if (target.layers.length !== 1 || oldLayer.typename === 'LayerSet' || kindName(oldLayer) !== 'pixel') { fail('Pixel import requires a single pixel layer in a temporary output document.', 'PSD2UI_PIXEL_TARGET_INVALID'); }
        if (params.replace === false) { fail('Only replace=true pixel import is supported.', 'PSD2UI_PIXEL_REPLACE_REQUIRED'); }
        var area = params.targetBounds || { left: 0, top: 0, width: pixels(target.width), height: pixels(target.height) };
        if (Number(area.left || 0) !== 0 || Number(area.top || 0) !== 0 || (area.width != null && Number(area.width) !== pixels(target.width)) || (area.height != null && Number(area.height) !== pixels(target.height))) {
            fail('Pixel import requires the complete output canvas.', 'PSD2UI_PIXEL_BOUNDS_UNSUPPORTED');
        }
        for (index = 0; index < app.documents.length; index += 1) { if (normalizedPath(documentPath(app.documents[index])) === normalizedPath(file.fsName)) { fail('Pixel import file is already open; use an independent temporary PNG.', 'PSD2UI_PIXEL_FILE_ALREADY_OPEN'); } }
        if (!file.exists) { fail('Pixel import PNG does not exist.', 'PSD2UI_FILE_NOT_FOUND'); }
        var knownIds = openDocumentIds();
        try {
            opened = app.open(file);
            if (has(knownIds, String(opened.id))) { fail('Pixel import reopened an existing document.', 'PSD2UI_TEMP_DOCUMENT_CREATE_FAILED'); }
            openedId = opened.id; temporaryDocuments[String(openedId)] = 'pixel-import';
            if (pixels(opened.width) !== pixels(target.width) || pixels(opened.height) !== pixels(target.height)) { fail('Pixel PNG dimensions do not match output canvas.', 'PSD2UI_PIXEL_SIZE_MISMATCH'); }
            if (opened.mode !== DocumentMode.RGB || opened.bitsPerChannel !== BitsPerChannelType.EIGHT) { fail('Pixel PNG must be 8-bit RGB.', 'PSD2UI_PIXEL_FORMAT_UNSUPPORTED'); }
            if (params.colorProfile) {
                var sourceProfile = ''; try { sourceProfile = String(opened.colorProfileName || ''); } catch (profileMissing) {}
                if (!sourceProfile || /untagged|none/i.test(sourceProfile)) { assignProfile(opened, String(params.colorProfile)); }
                else if (sourceProfile !== String(params.colorProfile)) { fail('PNG color profile differs from supplied pixel data profile.', 'PSD2UI_PIXEL_PROFILE_MISMATCH'); }
                // Replacing every pixel in an owned output document permits assigning
                // its profile. Otherwise duplicate() can convert between working RGBs.
                assignProfile(target, String(params.colorProfile)); activate(opened);
            }
            if (opened.layers.length !== 1) { opened.mergeVisibleLayers(); }
            var sourceLayer = opened.layers[0], sourceBounds = bounds(sourceLayer.bounds), copied = sourceLayer.duplicate(target, ElementPlacement.PLACEATBEGINNING);
            activate(target); preserveBounds(copied, sourceBounds); copied.name = oldLayer.name; oldLayer.remove();
            return { layerId: copied.id, id: copied.id };
        } finally {
            if (openedId != null && String(openedId) !== String(target.id) && findDocument(openedId)) { closeTemporary(requireDocument(openedId)); }
            restoreActive(previous);
        }
    };
    methods.chooseFolder = function () { var folder = Folder.selectDialog('Choose PSD2UI output folder'); return folder ? String(folder.fsName) : null; };
    methods.move = function (params) {
        var document = requireDocument(docId(params)), layer = requireLayer(document, layerId(params), 'move layer'), parentId = identifier(params, 'parentId', 'parentID');
        var beforeId = identifier(params, 'beforeId', 'beforeID'), afterId = identifier(params, 'afterId', 'afterID');
        if (beforeId != null && afterId != null) { fail('Specify beforeId or afterId, not both.', 'PSD2UI_INVALID_ARGUMENT'); }
        var parent = parentId == null || parentId === '' || String(parentId) === 'document-root' ? document : requireLayer(document, parentId, 'move parent');
        if (parent !== document && parent.typename !== 'LayerSet') { fail('Move parent must be a document or group.', 'PSD2UI_MOVE_PARENT_INVALID'); }
        if (parent !== document && descendantsContain(layer, parent)) { fail('Cannot move a layer into its descendant.', 'PSD2UI_MOVE_CYCLE'); }
        // ExtendScript associates unparenthesized chained conditionals differently
        // from modern JavaScript. Keep optional anchors as explicit branches.
        var anchor = null;
        if (beforeId != null) { anchor = requireLayer(document, beforeId, 'move before anchor'); }
        else if (afterId != null) { anchor = requireLayer(document, afterId, 'move after anchor'); }
        if (anchor && (String(anchor.id) === String(layer.id) || anchor.parent.typename !== parent.typename || String(anchor.parent.id) !== String(parent.id))) { fail('Move anchor must be another child of the target parent.', 'PSD2UI_MOVE_ANCHOR_INVALID'); }
        var before = bounds(layer.bounds); activate(document);
        if (anchor) { layer.move(anchor, beforeId != null ? ElementPlacement.PLACEBEFORE : ElementPlacement.PLACEAFTER); }
        else { layer.move(parent, ElementPlacement.PLACEATBEGINNING); }
        preserveBounds(layer, before); return { layerId: layer.id };
    };
    methods.ungroup = function (params) {
        var document = requireDocument(docId(params)), group = requireLayer(document, layerId(params));
        if (group.typename !== 'LayerSet') { fail('Only a group can be ungrouped.', 'PSD2UI_UNGROUP_NOT_GROUP'); }
        var children = [], index, parent = group.parent, groupId = group.id;
        for (index = 0; index < group.layers.length; index += 1) { children.push({ id: group.layers[index].id, bounds: bounds(group.layers[index].bounds) }); }
        select(document, [groupId], false);
        var descriptor = new ActionDescriptor(), reference = new ActionReference();
        reference.putIdentifier(sid('layer'), Number(groupId)); descriptor.putReference(cid('null'), reference);
        executeAction(sid('ungroupLayersEvent'), descriptor, DialogModes.NO);
        if (findLayer(document.layers, groupId)) { fail('Photoshop did not remove the group container.', 'PSD2UI_UNGROUP_FAILED'); }
        var ids = [];
        for (index = 0; index < children.length; index += 1) {
            var child = requireLayer(document, children[index].id);
            if (child.parent.typename !== parent.typename || String(child.parent.id) !== String(parent.id)) { fail('Ungrouped child has unexpected parent.', 'PSD2UI_UNGROUP_PARENT_CHANGED'); }
            preserveBounds(child, children[index].bounds); ids.push(child.id);
        }
        return { childIds: ids, childLayerIds: ids };
    };
    methods['delete'] = function (params) { var document = requireDocument(docId(params)), layer = requireLayer(document, layerId(params)); activate(document); layer.remove(); return null; };

    $.PSD2UIHost = {
        // Reused by the isolated ExtendScript smoke runner (the host has no JSON global).
        json: { parse: parseJson, stringify: stringifyJson },
        dispatchFile: function (path) {
            var file = File(String(path)), root = normalizedPath(Folder.temp.fsName + '/PSD2UI-CEP-rpc');
            try {
                if (normalizedPath(file.parent.fsName) !== root || !/^[a-f0-9]{32}\.json$/.test(file.name)) {
                    fail('Invalid CEP request file.', 'PSD2UI_INVALID_REQUEST_FILE');
                }
                if (!file.exists || file.length > 64 * 1024 * 1024) { fail('CEP request file missing or too large.', 'PSD2UI_INVALID_REQUEST_FILE'); }
                file.encoding = 'UTF-8';
                if (!file.open('r')) { fail('Cannot open CEP request file.', 'PSD2UI_INVALID_REQUEST_FILE'); }
                var raw;
                try { raw = file.read(); } finally { file.close(); }
                return $.PSD2UIHost.dispatch(raw);
            } catch (error) {
                return stringifyJson({ ok: false, error: { message: String(error.message || error), code: String(error.code || 'PSD2UI_HOST_ERROR') }, state: null });
            }
        },
        dispatch: function (jsonString) {
            var response, request, snapshot = null;
            try {
                if (parseFloat(String(app.version)) < 20) { fail('PSD2UI CEP requires Photoshop 20.0 or newer.', 'PSD2UI_UNSUPPORTED_PHOTOSHOP_VERSION'); }
                request = parseJson(jsonString);
                if (!request || typeof request !== 'object' || !has(methods, request.method)) { fail('Unknown Photoshop command.', 'PSD2UI_UNKNOWN_COMMAND'); }
                var value = methods[request.method](request.params || {});
                // CEP reads snapshots in pages. Pure reads and page failures must
                // never trigger a second, unbounded scan as a side effect.
                if (request.method !== 'state' && request.deferState !== true
                    && request.method !== 'probe' && request.method !== 'notificationEvents' && request.method !== 'beginState' && request.method !== 'statePage'
                    && request.method !== 'getXmp' && request.method !== 'readManifest') { snapshot = state(); }
                response = { ok: true, value: value, state: snapshot };
            } catch (error) {
                response = { ok: false, error: { message: String(error.message || error), code: String(error.code || error.number || 'PSD2UI_HOST_ERROR'), line: error.line == null ? null : Number(error.line) }, state: snapshot };
            }
            return stringifyJson(response);
        }
    };
}());
