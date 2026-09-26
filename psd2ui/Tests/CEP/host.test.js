'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const hostPath = path.resolve(__dirname, '../../Plus-ins/PSD2UI-CEP/host/photoshop.jsx');
const source = fs.readFileSync(hostPath, 'utf8');

test('ExtendScript sources avoid chained ternaries whose associativity differs in Adobe', () => {
  const acorn = require('acorn');
  for (const file of [hostPath, path.resolve(__dirname, '../../scripts/cep-smoke.jsx')]) {
    const tree = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 3, locations: true });
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'ConditionalExpression') {
        assert.notEqual(node.consequent.type, 'ConditionalExpression', `${file}:${node.loc.start.line}: use if/else for nested conditional`);
        assert.notEqual(node.alternate.type, 'ConditionalExpression', `${file}:${node.loc.start.line}: use if/else for nested conditional`);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    }
    visit(tree);
  }
});

function harness(options = {}) {
  const types = Object.fromEntries(['BOOLEANTYPE', 'STRINGTYPE', 'INTEGERTYPE', 'LARGEINTEGERTYPE', 'DOUBLETYPE', 'UNITDOUBLE', 'ENUMERATEDTYPE', 'OBJECTTYPE', 'LISTTYPE', 'REFERENCETYPE', 'ALIASTYPE', 'CLASSTYPE', 'RAWTYPE'].map(key => [key, key]));
  const forms = Object.fromEntries(['IDENTIFIER', 'INDEX', 'NAME', 'PROPERTY', 'ENUMERATED', 'OFFSET'].map(key => [key, key]));
  class Descriptor {
    constructor(entries = {}) { this.entries = entries; }
    get count() { return Object.keys(this.entries).length; }
    getKey(index) { return Object.keys(this.entries)[index]; }
    hasKey(key) { return Object.hasOwn(this.entries, key); }
    getType(key) { if (!this.hasKey(key)) throw new Error(`No descriptor key ${key}`); return this.entries[key].type; }
    put(key, type, value) { this.entries[key] = { type, value }; }
    getBoolean(key) { return this.entries[key].value; }
    getString(key) { return this.entries[key].value; }
    getInteger(key) { return this.entries[key].value; }
    getLargeInteger(key) { return this.entries[key].value; }
    getDouble(key) { return this.entries[key].value; }
    getUnitDoubleType(key) { return this.entries[key].value.unit; }
    getUnitDoubleValue(key) { return this.entries[key].value.number; }
    getEnumerationType(key) { return this.entries[key].value.type; }
    getEnumerationValue(key) { return this.entries[key].value.value; }
    getObjectType(key) { return this.entries[key].value.type; }
    getObjectValue(key) { return this.entries[key].value.value; }
    getList(key) { return this.entries[key].value; }
    getReference(key) { return this.entries[key].value; }
    getPath(key) { return this.entries[key].value; }
    getClass(key) { return this.entries[key].value; }
    getData(key) { return this.entries[key].value; }
    putReference(key, value) { this.put(key, types.REFERENCETYPE, value); }
    putBoolean(key, value) { this.put(key, types.BOOLEANTYPE, value); }
    putString(key, value) { this.put(key, types.STRINGTYPE, value); }
    putInteger(key, value) { this.put(key, types.INTEGERTYPE, value); }
    putObject(key, type, value) { this.put(key, types.OBJECTTYPE, { type, value }); }
    putPath(key, value) { this.put(key, types.ALIASTYPE, value); }
    putEnumerated(key, type, value) { this.put(key, types.ENUMERATEDTYPE, { type, value }); }
  }
  class List extends Descriptor { get count() { return this.entries.length; } }
  class Reference {
    constructor(parts = []) { this.parts = parts; }
    putIdentifier(type, value) { this.parts.push({ type, form: forms.IDENTIFIER, value }); }
    putProperty(type, value) { this.parts.push({ type, form: forms.PROPERTY, value }); }
    putIndex(type, value) { this.parts.push({ type, form: forms.INDEX, value }); }
    putClass(type) { this.parts.push({ type, form: 'CLASS' }); }
    putName(type, value) { this.parts.push({ type, form: forms.NAME, value }); }
    putEnumerated(type, enumType, value) { this.parts.push({ type, form: forms.ENUMERATED, enumType, value }); }
    getIdentifier() { return this.parts[0].value; }
    getIndex() { return this.parts[0].value; }
    getDesiredClass() { if (!this.parts[0]) throw new Error('End of reference'); return this.parts[0].type; }
    getForm() { return this.parts[0].form; }
    getName() { return this.parts[0].value; }
    getProperty() { return this.parts[0].value; }
    getEnumeratedType() { return this.parts[0].enumType; }
    getEnumeratedValue() { return this.parts[0].value; }
    getContainer() { return new Reference(this.parts.slice(1)); }
  }
  const unit = value => ({ value: Number(value), as: () => Number(value) });
  let nextId = 1000;
  const calls = [], historyReads = [], files = new Map(), snapshots = new Map();
  const documents = [];
  const blendModes = Object.fromEntries(['NORMAL', 'PASSTHROUGH', 'MULTIPLY'].map(key => [key, `BlendMode.${key}`]));
  const placements = Object.fromEntries(['PLACEATBEGINNING', 'PLACEATEND', 'PLACEBEFORE', 'PLACEAFTER'].map(key => [key, key]));
  let active = null;
  const app = {
    version: options.version || '20.0.4', documents,
    refresh() { calls.push(['refresh']); },
    get activeDocument() { return active; },
    set activeDocument(value) { calls.push(['activate', value.id]); active = value; },
    stringIDToTypeID: value => value, charIDToTypeID: value => value,
    typeIDToStringID: value => value, typeIDToCharID: value => value,
    open(file) {
      calls.push(['open', file.fsName]);
      const spec = files.get(file.fsName);
      if (!spec) throw new Error('Missing file');
      return createDocument({ ...spec, path: file.fsName });
    }
  };
  function rootOf(layer) { let current = layer; while (current.typename !== 'Document') current = current.parent; return current; }
  function flatten(layers) { return layers.flatMap(layer => [layer, ...flatten(layer.layers || [])]); }
  function cloneLayer(layer, parent) { return createLayer({ name: layer.name, kind: layer.kind, typename: layer.typename, bounds: [...layer.bounds], visible: layer.visible, opacity: layer.opacity, children: (layer.layers || []).map(child => ({ name: child.name, kind: child.kind, bounds: [...child.bounds] })) }, parent); }
  function createLayer(spec = {}, parent) {
    const layer = {
      id: spec.id || nextId++, name: spec.name || 'Layer', kind: spec.kind || 'LayerKind.NORMAL', typename: spec.typename || (spec.children ? 'LayerSet' : 'ArtLayer'),
      bounds: spec.bounds || [2, 3, 18, 19], boundsNoEffects: spec.bounds || [2, 3, 18, 19], visible: spec.visible !== false,
      opacity: spec.opacity == null ? 100 : spec.opacity, blendMode: spec.blendMode || blendModes.NORMAL, parent,
      grouped: spec.clipped === true, customDescriptor: spec.descriptor, textItem: spec.textItem,
      duplicate(destination, placement) {
        calls.push(['duplicateLayer', this.id, destination && destination.id, placement]);
        const owner = destination || this.parent, copy = cloneLayer(this, owner);
        if (destination) owner.layers.splice(placement === placements.PLACEATEND ? owner.layers.length : 0, 0, copy);
        else owner.layers.splice(owner.layers.indexOf(this), 0, copy);
        return copy;
      },
      translate(x, y) { calls.push(['translate', this.id, x.value, y.value]); this.bounds = this.bounds.map((value, index) => value + (index % 2 ? y.value : x.value)); this.boundsNoEffects = this.bounds; },
      move(destination, placement) {
        calls.push(['move', this.id, destination.id, placement]);
        this.parent.layers.splice(this.parent.layers.indexOf(this), 1);
        const owner = placement === placements.PLACEBEFORE || placement === placements.PLACEAFTER ? destination.parent : destination;
        const index = placement === placements.PLACEBEFORE ? owner.layers.indexOf(destination) : placement === placements.PLACEAFTER ? owner.layers.indexOf(destination) + 1 : placement === placements.PLACEATEND ? owner.layers.length : 0;
        owner.layers.splice(index, 0, this); this.parent = owner;
      },
      remove() { calls.push(['remove', this.id]); this.parent.layers.splice(this.parent.layers.indexOf(this), 1); }
    };
    if (layer.typename === 'LayerSet') layer.layers = (spec.children || []).map(child => createLayer(child, layer));
    return layer;
  }
  function createDocument(spec = {}) {
    const document = {
      id: spec.id || nextId++, name: spec.name || 'Art.psd', typename: 'Document', width: unit(spec.width || 32), height: unit(spec.height || 32), resolution: spec.resolution || 72,
      path: spec.path || '', mode: spec.mode || 'RGB', bitsPerChannel: spec.depth || 8, colorProfileName: spec.profile || 'sRGB IEC61966-2.1',
      xmpMetadata: { rawData: spec.xmp || '' },
      get fullName() { if (!this.path) throw new Error('Not saved'); return { fsName: this.path }; },
      get activeLayer() { return flatten(this.layers).find(layer => this.selected.includes(layer.id)); },
      get backgroundLayer() { if (!spec.background) throw new Error('No background'); return this.layers[this.layers.length - 1]; },
      save() { calls.push(['save', this.id]); },
      saveAs(file, saveOptions, asCopy) { calls.push(['savePng', this.id, file.fsName, saveOptions.compression, asCopy]); if (options.failSavePng) throw new Error('PNG encode failed'); files.set(file.fsName, { width: this.width.value, height: this.height.value }); },
      close() { calls.push(['close', this.id]); documents.splice(documents.indexOf(this), 1); active = documents[0] || null; },
      duplicate(name) { calls.push(['duplicateDocument', this.id]); return createDocument({ name, width: this.width.value, height: this.height.value, mode: this.mode, depth: this.bitsPerChannel, profile: this.colorProfileName, layers: this.layers.map(layer => ({ name: layer.name, bounds: [...layer.bounds] })) }); },
      changeMode(mode) { calls.push(['changeMode', this.id, mode]); this.mode = mode; },
      convertProfile(profile) { calls.push(['convertProfile', this.id, profile]); this.colorProfileName = profile; },
      trim() { calls.push(['trim', this.id]); }
    };
    document.layers = (spec.layers || [{}]).map(layer => createLayer(layer, document));
    document.selected = spec.selected || [document.layers[0].id];
    documents.push(document); active = document; return document;
  }
  documents.add = (width, height, resolution, name) => createDocument({ width: width.value, height: height.value, resolution, name });
  function layerDesc(layer) {
    const descriptor = new Descriptor();
    descriptor.put('layerID', types.INTEGERTYPE, layer.id); descriptor.put('name', types.STRINGTYPE, layer.name);
    descriptor.put('hasUserMask', types.BOOLEANTYPE, layer.hasLayerMask === true);
    descriptor.put('hasVectorMask', types.BOOLEANTYPE, layer.hasVectorMask === true);
    descriptor.put('group', types.BOOLEANTYPE, layer.grouped === true);
    descriptor.put('visible', types.BOOLEANTYPE, layer.visible);
    descriptor.put('opacity', types.INTEGERTYPE, layer.opacity * 255 / 100);
    descriptor.put('layerKind', types.INTEGERTYPE, layer.typename === 'LayerSet' ? 7 : layer.kind === 'LayerKind.TEXT' ? 3 : 1);
    descriptor.put('mode', types.ENUMERATEDTYPE, { type: 'blendMode', value: layer.blendMode.split('.').at(-1).toLowerCase() });
    for (const key of ['bounds', 'boundsNoEffects']) {
      const area = new Descriptor();
      const amBounds = layer.amBounds && layer.amBounds[key] || layer[key];
      ['left', 'top', 'right', 'bottom'].forEach((name, index) => area.put(name, types.UNITDOUBLE, { unit: 'pixelsUnit', number: amBounds[index] }));
      descriptor.put(key, types.OBJECTTYPE, { type: 'rectangle', value: area });
    }
    Object.assign(descriptor.entries, layer.customDescriptor || {}); return descriptor;
  }
  function layerRecords(document) {
    const records = [];
    function collect(layers) { layers.forEach(layer => {
      records.push({ layer, section: layer.typename === 'LayerSet' ? 'layerSectionStart' : 'layerSectionContent' });
      if (layer.layers) { collect(layer.layers); records.push({ section: 'layerSectionEnd' }); }
    }); }
    collect(document.layers); return records;
  }
  function executeActionGet(reference) {
    const part = reference.parts.find(entry => entry.type === 'document');
    const document = part ? documents.find(item => item.id === part.value) : active;
    if (reference.parts.some(entry => entry.type === 'historyState')) {
      historyReads.push({ documentId: document.id, scoped: Boolean(part) });
      if (part && options.rejectScopedHistory) throw new Error('The command Get is not currently available.');
      if (!part && options.failActiveHistory === document.id) throw new Error('Injected active history read failure');
      const descriptor = new Descriptor();
      descriptor.put('ID', types.INTEGERTYPE, document.historyId || 1);
      return descriptor;
    }
    const property = reference.parts.find(entry => entry.form === forms.PROPERTY);
    if (property) {
      const descriptor = new Descriptor();
      if (property.value === 'targetLayersIDs') {
        descriptor.put('targetLayersIDs', types.LISTTYPE, new List(document.selected.map(id => { const value = new Reference(); value.putIdentifier('layer', id); return { type: types.REFERENCETYPE, value }; })));
      }
      if (property.value === 'visible' || property.value === 'name') {
        const target = reference.parts.find(entry => entry.type === 'layer');
        const layer = flatten(document.layers).find(item => item.id === target.value);
        if (!layer) throw new Error('Missing layer');
        if (property.value === 'name') descriptor.put('name', types.STRINGTYPE, layer.name);
        else descriptor.put('visible', types.BOOLEANTYPE, layer.visible);
      }
      if (property.value === 'numberOfLayers') {
        let count = layerRecords(document).length;
        try { document.backgroundLayer; count--; } catch (_) {}
        descriptor.put('numberOfLayers', types.INTEGERTYPE, count);
      }
      return descriptor;
    }
    const layer = reference.parts.find(entry => entry.type === 'layer');
    if (layer.form === forms.INDEX) {
      const records = layerRecords(document);
      let offset = 1;
      try { document.backgroundLayer; offset = 0; } catch (_) {}
      const record = records[records.length - 1 - (layer.value - offset)];
      if (!record) throw new Error('Invalid native layer index');
      const descriptor = record.layer ? layerDesc(record.layer) : new Descriptor();
      descriptor.put('layerSection', types.ENUMERATEDTYPE, { type: 'layerSectionType', value: record.section });
      return descriptor;
    }
    const resolved = flatten(document.layers).find(item => item.id === layer.value);
    if (!resolved) throw new Error('Missing layer');
    return layerDesc(resolved);
  }
  function capture(layers) { return layers.map(layer => ({ ref: layer, name: layer.name, visible: layer.visible, bounds: [...layer.bounds], children: layer.layers ? capture(layer.layers) : null })); }
  function restore(entries, parent) { return entries.map(entry => { Object.assign(entry.ref, { parent, name: entry.name, visible: entry.visible, bounds: entry.bounds, boundsNoEffects: entry.bounds }); if (entry.children) entry.ref.layers = restore(entry.children, entry.ref); return entry.ref; }); }
  function executeAction(action, descriptor) {
    calls.push(['action', action]);
    const reference = descriptor.hasKey('null') ? descriptor.getReference('null') : null;
    const target = reference && reference.parts[0];
    if (action === 'select' && target.type === 'layer') {
      if (descriptor.hasKey('selectionModifier')) active.selected.push(target.value); else active.selected = [target.value];
    } else if (action === 'Mk  ' && target.type === 'SnpS') {
      assert.equal(descriptor.getEnumerationValue('Usng'), 'FllD');
      snapshots.set(descriptor.getString('Nm  '), { document: active, layers: capture(active.layers), selected: [...active.selected] });
    } else if (action === 'slct' && target.type === 'SnpS') {
      const snapshot = snapshots.get(target.value); if (!snapshot || snapshot.document !== active) throw new Error('Snapshot in wrong document');
      active.layers = restore(snapshot.layers, active); active.selected = snapshot.selected;
    } else if (action === 'Dlt ' && target.type === 'SnpS') { snapshots.delete(target.value); }
    else if (action === 'make') {
      const members = flatten(active.layers).filter(layer => active.selected.includes(layer.id));
      const parent = members[0].parent, insertion = parent.layers.indexOf(members[0]);
      for (const member of members) parent.layers.splice(parent.layers.indexOf(member), 1);
      const group = createLayer({ children: [] }, parent); group.layers = members; members.forEach(member => { member.parent = group; });
      parent.layers.splice(insertion, 0, group); active.selected = [group.id];
    } else if (action === 'ungroupLayersEvent') {
      assert.equal(target.type, 'layer'); assert.equal(target.value, active.activeLayer.id);
      const group = active.activeLayer, parent = group.parent, index = parent.layers.indexOf(group);
      parent.layers.splice(index, 1, ...group.layers); group.layers.forEach(layer => { layer.parent = parent; }); active.selected = group.layers.map(layer => layer.id);
    } else if (action === 'assignProfile') { active.colorProfileName = descriptor.getString('profile'); }
    else if (action === 'save') {
      assert.equal(descriptor.getInteger('DocI'), active.id);
      assert.equal(descriptor.getBoolean('embedProfiles'), true);
      active.saveAs(descriptor.getPath('In  '), { compression: descriptor.getObjectValue('As  ').getInteger('compression') }, descriptor.getBoolean('Cpy '));
    }
    else throw new Error(`Unimplemented mock action ${action}`);
  }
  function File(name) {
    if (!(this instanceof File)) return new File(name);
    this.fsName = name; this.exists = files.has(name);
    this.name = path.posix.basename(name); this.parent = { fsName: path.posix.dirname(name) };
    this.length = options.fileLength != null ? options.fileLength : Buffer.byteLength(String(files.get(name) || ''), 'utf8');
    this.open = () => this.exists; this.read = () => files.get(name); this.close = () => {};
  }
  function XMPMeta(raw) { this.values = raw ? JSON.parse(raw) : {}; }
  XMPMeta.registerNamespace = () => {};
  XMPMeta.prototype.getProperty = function (uri, key) { return this.values[uri + key] == null ? null : { value: this.values[uri + key] }; };
  XMPMeta.prototype.setProperty = function (uri, key, value) { this.values[uri + key] = value; };
  XMPMeta.prototype.serialize = function () { return JSON.stringify(this.values); };
  const sandbox = {
    ...(options.clock ? { Date: options.clock } : {}),
    $, app, ActionDescriptor: Descriptor, ActionReference: Reference, DescValueType: types, ReferenceFormType: forms,
    executeAction, executeActionGet, UnitValue: function (value) { return unit(value); }, File,
    Folder: { temp: { fsName: 'F:/Temp' }, selectDialog: () => options.folder ? { fsName: options.folder } : null },
    PNGSaveOptions: function () {}, DialogModes: { NO: 'NO' }, ElementPlacement: placements, BlendMode: blendModes,
    NewDocumentMode: { RGB: 'RGB' }, DocumentFill: { TRANSPARENT: 'transparent' }, BitsPerChannelType: { EIGHT: 8 },
    DocumentMode: { RGB: 'RGB' }, ChangeMode: { RGB: 'RGB' }, Intent: { RELATIVECOLORIMETRIC: 'relative' },
    TrimType: { TRANSPARENT: 'transparent' }, Extension: { LOWERCASE: 'lowercase' }, SaveOptions: { DONOTSAVECHANGES: 'discard' },
    XMPMeta, ExternalObject: function () {}
  };
  function $(unused) { return unused; }
  vm.runInNewContext(source, sandbox, { filename: hostPath });
  function rpc(method, params = {}) { return JSON.parse(sandbox.$.PSD2UIHost.dispatch(JSON.stringify({ method, params }))); }
  return { rpc, raw: input => JSON.parse(sandbox.$.PSD2UIHost.dispatch(input)), fromFile: file => JSON.parse(sandbox.$.PSD2UIHost.dispatchFile(file)), codec: sandbox.$.PSD2UIHost.json, app, calls, historyReads, createDocument, files, snapshots, types, Descriptor, List };
}

test('Photoshop 2020 probe reads active history without unsupported document containers or activation', () => {
  const h = harness({ version: '21.2.3', rejectScopedHistory: true });
  const doc = h.createDocument(); doc.historyId = 226;
  const result = h.rpc('probe');
  assert.equal(result.ok, true);
  assert.equal(result.value.documents[0].historyId, 226);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.historyReads, [{ documentId: doc.id, scoped: false }]);
});

test('Photoshop 2020 inactive history uses cached revisions and rechecks on activation without activating during probes', () => {
  const h = harness({ version: '21.2.3', rejectScopedHistory: true });
  const first = h.createDocument({ id: 11 }); first.historyId = 100;
  const second = h.createDocument({ id: 22 }); second.historyId = 200;
  const selected = [first.selected.slice(), second.selected.slice()];
  for (let index = 0; index < 2; index++) {
    const result = h.rpc('probe');
    assert.equal(result.ok, true);
    assert.equal(result.value.activeDocumentId, second.id);
    assert.deepEqual(result.value.documents.map(doc => doc.historyId), ['inactive:11', 200]);
    assert.equal(h.app.activeDocument, second);
    assert.deepEqual([first.selected, second.selected], selected);
  }
  assert.equal(h.historyReads.filter(read => read.scoped).length, 1);
  assert.deepEqual(h.calls, []);
  h.app.activeDocument = first; h.calls.length = 0;
  second.historyId = 300;
  assert.deepEqual(h.rpc('probe').value.documents.map(doc => doc.historyId), [100, 200]);
  assert.deepEqual(h.calls, []);
  h.app.activeDocument = second; h.calls.length = 0;
  assert.deepEqual(h.rpc('probe').value.documents.map(doc => doc.historyId), [100, 300]);
  assert.deepEqual(h.calls, []);
});

test('Photoshop 2020 failed active history reads do not change focus', () => {
  const h = harness({ rejectScopedHistory: true, failActiveHistory: 22 });
  h.createDocument({ id: 11 }); const second = h.createDocument({ id: 22 });
  const result = h.rpc('probe');
  assert.equal(result.ok, false);
  assert.match(result.error.message, /Injected active history read failure/);
  assert.equal(h.app.activeDocument, second);
  assert.deepEqual(h.calls, []);
});

test('Photoshop 2020 clears closed document history entries before an ID is reused', () => {
  const h = harness({ rejectScopedHistory: true });
  const first = h.createDocument({ id: 11 }); first.historyId = 100;
  h.rpc('probe'); first.close(); h.rpc('probe');
  h.createDocument({ id: 11 }); h.createDocument({ id: 22 }); h.calls.length = 0;
  assert.equal(h.rpc('probe').value.documents[0].historyId, 'inactive:11');
  assert.deepEqual(h.calls, []);
});

test('state reads complete text/AM data without activating documents or changing selection', () => {
  const h = harness(), t = h.types;
  const style = new h.Descriptor({ impliedFontSize: { type: t.UNITDOUBLE, value: { unit: 'pointsUnit', number: 20 } } });
  const textKey = new h.Descriptor({ textStyleRange: { type: t.LISTTYPE, value: new h.List([{ type: t.OBJECTTYPE, value: { type: 'textStyleRange', value: new h.Descriptor({ textStyle: { type: t.OBJECTTYPE, value: { type: 'textStyle', value: style } } }) } }]) } });
  const first = h.createDocument({ path: 'F:/艺术/页面.psd', layers: [{ kind: 'LayerKind.TEXT', descriptor: { textKey: { type: t.OBJECTTYPE, value: { type: 'textLayer', value: textKey } }, mode: { type: t.ENUMERATEDTYPE, value: { type: 'blendMode', value: 'multiply' } } }, textItem: { contents: '文字\n"\\测试', size: 20, leading: 24, kind: 'TextType.PARAGRAPHTEXT', justification: 'Justification.CENTER', color: { rgb: { red: 12, green: 34, blue: 56 } } } }] });
  first.layers[0].hasLayerMask = true; first.layers[0].grouped = true;
  const second = h.createDocument({ selected: [] }); h.calls.length = 0;
  const response = h.rpc('state');
  assert.equal(response.ok, true); assert.equal(response.value.activeDocumentId, second.id); assert.deepEqual(h.calls, []);
  const layer = response.value.documents[0].layers[0];
  assert.equal(response.value.documents[0].path, 'F:/艺术/页面.psd'); assert.equal(layer.kind, 'text'); assert.equal(layer.hasLayerMask, true); assert.equal(layer.clipped, true);
  assert.equal(layer.textItem.contents, '文字\n"\\测试'); assert.equal(layer.textItem.isParagraphText, true);
  assert.deepEqual(layer.descriptor.textKey.textStyleRange[0].textStyle.impliedFontSize, { _unit: 'pointsUnit', _value: 20 });
  assert.deepEqual(layer.descriptor.mode, { _enum: 'blendMode', _value: 'multiply' });
  assert.deepEqual(response.value.documents[1].activeLayerIds, []);
});

test('CEP state retains every Photoshop text style range and inherited RGB descriptor', () => {
  const h = harness(), t = h.types;
  const color = (red, green, blue) => new h.Descriptor({
    red: { type: t.DOUBLETYPE, value: red }, green: { type: t.DOUBLETYPE, value: green },
    blue: { type: t.DOUBLETYPE, value: blue }
  });
  const range = (from, to, rgb) => ({ type: t.OBJECTTYPE, value: {
    type: 'textStyleRange', value: new h.Descriptor({
      from: { type: t.INTEGERTYPE, value: from }, to: { type: t.INTEGERTYPE, value: to },
      textStyle: { type: t.OBJECTTYPE, value: { type: 'textStyle', value: new h.Descriptor({
        baseParentStyle: { type: t.OBJECTTYPE, value: { type: 'textStyle', value: new h.Descriptor({
          color: { type: t.OBJECTTYPE, value: { type: 'RGBColor', value: rgb } },
          fontPostScriptName: { type: t.STRINGTYPE, value: 'FZHTJW' }
        }) } }
      }) } }
    })
  } });
  const textKey = new h.Descriptor({
    textKey: { type: t.STRINGTYPE, value: '甲乙' },
    textStyleRange: { type: t.LISTTYPE, value: new h.List([
      range(0, 1, color(0, 153, 102)), range(1, 2, color(128, 136, 144))
    ]) }
  });
  h.createDocument({ layers: [{ kind: 'LayerKind.TEXT', descriptor: {
    textKey: { type: t.OBJECTTYPE, value: { type: 'textLayer', value: textKey } }
  }, textItem: { contents: '甲乙', size: 20, leading: 24, kind: 'TextType.POINTTEXT',
    color: { rgb: { red: 0, green: 153, blue: 102 } } } }] });
  const response = h.rpc('state');
  assert.equal(response.ok, true);
  const text = response.value.documents[0].layers[0].descriptor.textKey;
  assert.equal(text.textKey, '甲乙');
  assert.deepEqual(text.textStyleRange.map((entry) => [entry.from, entry.to]), [[0, 1], [1, 2]]);
  assert.deepEqual(text.textStyleRange[1].textStyle.baseParentStyle.color,
    { _obj: 'RGBColor', red: 128, green: 136, blue: 144 });
  assert.equal(text.textStyleRange[1].textStyle.baseParentStyle.fontPostScriptName, 'FZHTJW');
});

test('additive selection touches only new IDs and validates all targets before selecting', () => {
  const h = harness(), doc = h.createDocument({ layers: Array.from({ length: 12 }, (_, i) => ({ name: 'Layer' + i })) });
  doc.selected = [];
  for (const layer of doc.layers) {
    const result = h.raw(JSON.stringify({ method: 'select', deferState: true,
      params: { documentId: doc.id, layerIds: [layer.id], add: true } }));
    assert.equal(result.ok, true);
  }
  assert.deepEqual(doc.selected, doc.layers.map(layer => layer.id));
  assert.equal(h.calls.filter(call => call[0] === 'action' && call[1] === 'select').length, 12);
  const invalid = h.rpc('select', { documentId: doc.id, layerIds: [doc.layers[1].id, -1], add: false });
  assert.equal(invalid.ok, false);
  assert.equal(doc.selected.length, 12);
  h.rpc('select', { documentId: doc.id, layerIds: [doc.layers[1].id], add: true });
  assert.equal(h.calls.filter(call => call[0] === 'action' && call[1] === 'select').length, 12);
});

test('state pages preserve all layers and never read large document XMP', () => {
  const h = harness();
  const doc = h.createDocument({ layers: [{ name: 'Group', children: Array.from({ length: 20 }, (_, i) => ({ name: 'Layer ' + i })) }, { name: 'Last' }] });
  Object.defineProperty(doc.xmpMetadata, 'rawData', { get() { throw new Error('Do not read XMP for a tree snapshot'); } });
  const expected = h.rpc('state').value;
  assert.equal(expected.documents[0].xmp, undefined);
  assert.equal(h.rpc('state').state, null, 'a tree must not be serialized twice');
  const start = h.rpc('beginState');
  assert.equal(start.ok, true);
  const items = [];
  let pages = 0;
  for (;;) {
    const response = h.rpc('statePage', { token: start.value.token });
    assert.equal(response.ok, true); assert.equal(response.state, null);
    assert.ok(response.value.items.length <= 8);
    items.push(...response.value.items); pages++;
    if (response.value.done) break;
  }
  assert.ok(pages >= 3); assert.equal(items.length, 22);
  assert.deepEqual(items.filter(item => item.parentId === doc.layers[0].id).map(item => item.layer.name), doc.layers[0].layers.map(layer => layer.name));
  assert.equal(items.at(-1).parentId, null); assert.deepEqual(h.calls, []);
  assert.equal(h.rpc('statePage', { token: start.value.token }).error.code, 'PSD2UI_STATE_READ_EXPIRED');
});

test('incremental snapshots read only changed documents and never reuse mismatched dimensions or history', () => {
  const h = harness(), first = h.createDocument(), second = h.createDocument();
  const known = h.rpc('probe').value.documents;
  Object.defineProperty(first.layers[0], 'customDescriptor', { get() { throw new Error('Unchanged document was scanned'); } });
  second.historyId = 2;
  const begin = h.rpc('beginState', { knownDocuments: known }).value;
  assert.deepEqual(begin.reusedDocumentIds, [first.id]);
  const page = h.rpc('statePage', { token: begin.token });
  assert.equal(page.ok, true);
  assert.deepEqual(page.value.items.map(item => item.documentId), [second.id]);
  const changedDimensions = known.map(doc => ({ ...doc, width: doc.width + 1 }));
  assert.deepEqual(h.rpc('beginState', { knownDocuments: changedDimensions }).value.reusedDocumentIds, []);
});

test('paged layer lookup avoids rescanning earlier layers and rejects stale IDs', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ name: 'Earlier' }, { name: 'Target' }] });
  const target = doc.layers[1], id = target.id;
  const begin = h.rpc('beginState').value;
  assert.equal(h.rpc('statePage', { token: begin.token }).value.done, true);
  const original = doc.layers[0].id;
  Object.defineProperty(doc.layers[0], 'id', { configurable: true, get() { throw new Error('Scanned earlier layer'); } });
  const change = h.raw(JSON.stringify({ method: 'setLayer', params: { documentId: doc.id, layerId: id, name: 'Changed' }, deferState: true }));
  assert.equal(change.ok, true);
  assert.equal(target.name, 'Changed');
  Object.defineProperty(doc.layers[0], 'id', { configurable: true, value: original });
  // Simulate an index-based DOM proxy now resolving to another layer.
  target.id = 999999;
  const stale = h.raw(JSON.stringify({ method: 'setLayer', params: { documentId: doc.id, layerId: id, name: 'Wrong target' }, deferState: true }));
  assert.equal(stale.error.code, 'PSD2UI_LAYER_NOT_FOUND');
  assert.equal(target.name, 'Changed');
});

test('idle probe reads neither layer descriptors nor XMP and rejects a changed paged snapshot', () => {
  const h = harness(), doc = h.createDocument();
  Object.defineProperty(doc.layers[0], 'customDescriptor', { get() { throw new Error('Layer scan'); } });
  Object.defineProperty(doc.xmpMetadata, 'rawData', { get() { throw new Error('XMP scan'); } });
  assert.equal(h.rpc('probe').ok, true);
  const start = h.rpc('beginState').value;
  doc.historyId = 2;
  const page = h.rpc('statePage', { token: start.token });
  assert.equal(page.error.code, 'PSD2UI_STATE_CHANGED'); assert.equal(page.state, null);
  assert.deepEqual(h.calls, []);
});

test('indexed pages preserve empty/nested groups, background index zero and DOM group bounds', () => {
  const h = harness(), doc = h.createDocument({ background: true, layers: [
    { name: 'Group', children: [{ name: 'Nested', children: [] }, { name: 'Pixel' }] }, { name: 'Background' }
  ] });
  const wrongCanvasBounds = new h.Descriptor();
  for (const [name, value] of Object.entries({ left: 0, top: 0, right: 1024, bottom: 2048 })) {
    wrongCanvasBounds.put(name, h.types.UNITDOUBLE, { unit: 'pixelsUnit', number: value });
  }
  doc.layers[0].customDescriptor = { bounds: { type: h.types.OBJECTTYPE, value: { type: 'rectangle', value: wrongCanvasBounds } } };
  const start = h.rpc('beginState').value;
  const response = h.rpc('statePage', { token: start.token });
  assert.equal(response.ok, true); assert.equal(response.value.done, true);
  assert.deepEqual(response.value.items.map(item => [item.layer.name, item.parentId]), [
    ['Group', null], ['Nested', doc.layers[0].id], ['Pixel', doc.layers[0].id], ['Background', null]
  ]);
  assert.deepEqual(response.value.items[0].layer.bounds, { left: 2, top: 3, right: 18, bottom: 19 });
});

test('interactive snapshots never access rendered group bounds; geometry RPC reads only the requested group', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ name: 'Group', children: [{ name: 'Child' }] }, { name: 'Other', children: [] }] });
  let domReads = 0;
  for (const group of doc.layers) {
    group.amBounds = { bounds: [0, 0, 1024, 2048], boundsNoEffects: [0, 0, 1024, 2048] };
    for (const key of ['bounds', 'boundsNoEffects']) Object.defineProperty(group, key, { get() { domReads++; return [2, 3, 18, 19]; } });
  }
  const start = h.rpc('beginState', { deferGeometry: true }).value;
  const page = h.rpc('statePage', { token: start.token });
  assert.equal(page.ok, true, JSON.stringify(page.error));
  assert.equal(domReads, 0);
  assert.equal(page.value.items[0].layer.deferredBounds, true);
  const geometry = h.rpc('readGeometry', { documentId: doc.id, layerIds: [doc.layers[0].id], stamp: start.stamp });
  assert.equal(geometry.ok, true, JSON.stringify(geometry.error));
  assert.equal(geometry.state, null);
  assert.equal(domReads, 2);
  assert.deepEqual(geometry.value.layers[0].bounds, { left: 2, top: 3, right: 18, bottom: 19 });
  doc.historyId = 2;
  assert.equal(h.rpc('readGeometry', { documentId: doc.id, layerIds: [doc.layers[1].id], stamp: start.stamp }).error.code, 'PSD2UI_STATE_CHANGED');
  assert.equal(domReads, 2);
});

test('JSON codec roundtrips long XML, escapes and Unicode across chunk boundaries', () => {
  const h = harness();
  const value = { xmp: '<tag value="美术\\文档">\n\t\u0000\u2028\u2029🦆</tag>'.repeat(10000) };
  const serialized = h.codec.stringify(value);
  assert.deepEqual(JSON.parse(serialized), value);
  assert.equal(h.codec.parse(serialized).xmp, value.xmp);
});

test('JSON scanner handles window boundaries and rejects malformed numeric tokens', () => {
  const h = harness();
  const value = { rows: Array.from({ length: 300 }, (_, index) => ({
    name: '文'.repeat(2040 + index % 20) + '\\"\n\u2028',
    numeric: [-1.25e-17, 0, 0.9960600137710571, 1e24], flag: true, empty: null
  })) };
  assert.deepEqual(JSON.parse(JSON.stringify(h.codec.parse(JSON.stringify(value)))), value);
  for (const raw of ['01', '1e', '1.', '--1', '1+2', '+2', '[1e+]', '"bad\nstring"', '"\\uZZZZ"']) {
    assert.throws(() => h.codec.parse(raw), undefined, raw);
  }
});

test('file RPC accepts only staged JSON and keeps the fixed command and deferred snapshot boundaries', () => {
  const h = harness(), doc = h.createDocument();
  const file = 'F:/Temp/PSD2UI-CEP-rpc/' + 'a'.repeat(32) + '.json';
  const serializedManifest = JSON.stringify({ text: '中文字\n"\\'.repeat(10000) });
  h.files.set(file, JSON.stringify({ method: 'writeManifest', params: { documentId: doc.id, serializedManifest }, deferState: true }));
  assert.equal(h.fromFile(file).ok, true);
  assert.equal(h.fromFile(file).state, null);
  assert.deepEqual(h.rpc('readManifest', { documentId: doc.id }).value, JSON.parse(serializedManifest));
  h.files.set(file, JSON.stringify({ method: 'eval', params: { script: 'app.activeDocument.close()' } }));
  assert.equal(h.fromFile(file).error.code, 'PSD2UI_UNKNOWN_COMMAND');
  for (const bad of ['F:/Art/secret.json', 'F:/Temp/PSD2UI-CEP-rpc/other.json', 'F:/Temp/PSD2UI-CEP-rpc/' + 'b'.repeat(32) + '.json']) {
    assert.equal(h.fromFile(bad).error.code, 'PSD2UI_INVALID_REQUEST_FILE');
  }
});

test('staged validated Manifest bypasses ES3 JSON parsing and preserves exact XMP readback and receipt', () => {
  const h = harness(), doc = h.createDocument({ xmp: '{"other":"unchanged"}' });
  const file = 'F:/Temp/PSD2UI-CEP-rpc/' + 'a'.repeat(32) + '.manifest.json';
  // A deeply nested valid JSON value cannot pass the legacy recursive parser.
  const serialized = '{"nested":'.repeat(3000) + JSON.stringify('文"\\\n\u2028🦆') + '}'.repeat(3000);
  h.files.set(file, serialized);
  const response = h.raw(JSON.stringify({ method: 'writeManifest', params: { documentID: doc.id,
    serializedManifestFile: file, serializedManifestLength: serialized.length, validated: true }, deferState: true }));
  assert.equal(response.ok, true, JSON.stringify(response.error));
  assert.equal(response.state, null);
  assert.deepEqual(response.value, { verified: true, documentId: doc.id, serializedLength: serialized.length });
  assert.equal(h.rpc('readManifest', { documentId: doc.id, serialized: true }).value, serialized);
  assert.equal(JSON.parse(doc.xmpMetadata.rawData).other, 'unchanged');
});

test('staged Manifest paths, identity metadata, length and size are checked before writing XMP', () => {
  const file = 'F:/Temp/PSD2UI-CEP-rpc/' + 'a'.repeat(32) + '.manifest.json';
  for (const override of [
    { serializedManifestFile: 'F:/Art/secret.manifest.json' },
    { serializedManifestFile: 'F:/Temp/PSD2UI-CEP-rpc/not-owned.manifest.json' },
    { serializedManifestFile: 'F:/Temp/PSD2UI-CEP-rpc/' + 'a'.repeat(32) + '.json' },
    { serializedManifestLength: 8 }, { serializedManifestLength: '7' }, { serializedManifestLength: 7.5 },
    { validated: false }, { serializedManifest: '{}' }, { manifest: {} }
  ]) {
    const h = harness(), doc = h.createDocument({ xmp: '{"original":true}' });
    h.files.set(file, '{"x":1}');
    const result = h.rpc('writeManifest', { documentId: doc.id, serializedManifestFile: file,
      serializedManifestLength: 7, validated: true, ...override });
    assert.equal(result.ok, false, JSON.stringify(override));
    assert.match(result.error.code, /^PSD2UI_INVALID_(?:REQUEST|MANIFEST)_FILE$/);
    assert.equal(doc.xmpMetadata.rawData, '{"original":true}');
  }
  for (const options of [{}, { fileLength: 64 * 1024 * 1024 + 1 }]) {
    const h = harness(options), doc = h.createDocument({ xmp: '{"original":true}' });
    if (options.fileLength) h.files.set(file, '{"x":1}');
    const result = h.rpc('writeManifest', { documentId: doc.id, serializedManifestFile: file, serializedManifestLength: 7, validated: true });
    assert.equal(result.error.code, 'PSD2UI_INVALID_REQUEST_FILE');
    assert.equal(doc.xmpMetadata.rawData, '{"original":true}');
  }
});

test('RPC rejects malformed JSON and arbitrary commands without evaluating or mutating', () => {
  const h = harness(); const doc = h.createDocument(); h.calls.length = 0;
  assert.equal(h.raw('{"method":"state"}; app.activeDocument.close()').error.code, 'PSD2UI_INVALID_JSON');
  assert.equal(h.rpc('constructor').error.code, 'PSD2UI_UNKNOWN_COMMAND');
  assert.equal(h.rpc('eval', { source: 'app.documents[0].close()' }).error.code, 'PSD2UI_UNKNOWN_COMMAND');
  assert.equal(h.raw('{"method":"state","params":{"__proto__":{}}}').error.code, 'PSD2UI_INVALID_JSON');
  assert.deepEqual(h.calls, []); assert.equal(h.app.documents[0], doc);
  assert.equal(harness({ version: '19.1' }).rpc('state').error.code, 'PSD2UI_UNSUPPORTED_PHOTOSHOP_VERSION');
});

test('serialized Manifest read preserves original numeric precision and defers parsing to CEP', () => {
  const h = harness(), doc = h.createDocument();
  const serialized = '{"color":0.9960600137710571,"text":"escaped\\n美术"}';
  assert.equal(h.rpc('writeManifest', { documentId: doc.id, serializedManifest: serialized }).ok, true);
  Object.defineProperty(doc.layers[0], 'customDescriptor', { get() { throw new Error('Unexpected layer scan'); } });
  const response = h.rpc('readManifest', { documentId: doc.id, serialized: true });
  assert.equal(response.ok, true);
  assert.equal(response.value, serialized);
  assert.equal(response.state, null);
  assert.equal(h.rpc('notificationEvents').ok, true, 'event registration must not scan layers');
});

test('text DOM fallback converts point size using document resolution without global unit changes', () => {
  const h = harness();
  h.createDocument({ resolution: 144, layers: [{ kind: 'LayerKind.TEXT', textItem: { contents: 'Hi', size: { as: () => 20 }, leading: { as: () => 25 }, kind: 'TextType.POINTTEXT', justification: 'Justification.LEFT', color: { rgb: { red: 0, green: 0, blue: 0 } } } }] });
  const response = h.rpc('state'); assert.equal(response.ok, true);
  assert.equal(response.value.documents[0].layers[0].textItem.characterStyle.size, 40);
  assert.equal(response.value.documents[0].layers[0].textItem.characterStyle.leading, 50);
});

test('setLayer validates properties before changing a layer and targets IDs instead of active document', () => {
  const h = harness(), first = h.createDocument(), second = h.createDocument();
  const original = first.layers[0].name;
  assert.equal(h.rpc('setLayer', { documentID: first.id, layerID: first.layers[0].id, values: { name: 'changed', unsupported: true } }).ok, false);
  assert.equal(first.layers[0].name, original);
  assert.equal(h.rpc('setLayer', { documentId: first.id, layerId: first.layers[0].id, name: '新名"\\\n', visible: false, opacity: 40, blendMode: 'multiply' }).ok, true);
  assert.equal(first.layers[0].name, '新名"\\\n'); assert.equal(first.layers[0].opacity, 40); assert.equal(first.layers[0].visible, false);
  assert.equal(second.layers[0].name, 'Layer');
  assert.equal(h.rpc('setLayer', { documentId: second.id, layerId: first.layers[0].id, name: 'wrong' }).error.code, 'PSD2UI_LAYER_NOT_FOUND');
});

test('history snapshots restore the token document after another document becomes active', () => {
  const h = harness(), first = h.createDocument({ layers: [{ name: 'Before' }] }), second = h.createDocument();
  const token = h.rpc('beginHistory', { documentId: first.id, name: '结构编辑' }).value;
  h.rpc('setLayer', { documentId: first.id, layerId: first.layers[0].id, name: 'After' });
  h.app.activeDocument = second;
  assert.equal(h.rpc('endHistory', { token: { ...token, documentId: second.id }, commit: false }).error.code, 'PSD2UI_HISTORY_TOKEN_INVALID');
  assert.equal(first.layers[0].name, 'After');
  const rolledBack = h.rpc('endHistory', { token, commit: false });
  assert.equal(rolledBack.ok, true); assert.equal(rolledBack.value.snapshotRetained, true);
  assert.equal(first.layers[0].name, 'Before'); assert.equal(second.layers[0].name, 'Layer'); assert.equal(h.snapshots.size, 1);
  assert.equal(h.calls.some(call => call[0] === 'action' && call[1] === 'Dlt '), false);
  assert.equal(h.rpc('endHistory', { token, commit: false }).error.code, 'PSD2UI_HISTORY_TOKEN_INVALID');
});

test('temporary document close cannot close production PSDs or an already open PNG', () => {
  const h = harness(), sourceDoc = h.createDocument({ path: 'F:/Art/Source.psd' }), png = h.createDocument({ name: 'Already.png', path: 'F:/Art/Already.png' });
  assert.equal(h.rpc('close', { documentID: sourceDoc.id }).error.code, 'PSD2UI_DOCUMENT_NOT_TEMPORARY');
  assert.equal(h.rpc('open', { path: png.path }).value.documentId, png.id);
  assert.equal(h.rpc('close', { documentID: png.id }).error.code, 'PSD2UI_DOCUMENT_NOT_TEMPORARY');
  const temp = h.rpc('addDocument', { name: 'PSD2UI_Resource_Workbench', width: 32, height: 32 }).value;
  h.app.activeDocument = sourceDoc;
  assert.equal(h.rpc('close', { documentID: temp.id }).ok, true);
  assert.deepEqual(h.app.documents.map(doc => doc.id), [sourceDoc.id, png.id]); assert.equal(h.app.activeDocument, sourceDoc);
});

test('Manifest writes preserve unrelated XMP and leave save/sidecar transaction to caller', () => {
  const h = harness(), doc = h.createDocument({ path: 'F:/Art/Source.psd', xmp: JSON.stringify({ unrelated: 'keep me' }) });
  const manifest = { document: { id: '文档' }, names: ['"\\', '\n'] };
  assert.equal(h.rpc('writeManifest', { documentID: doc.id, serializedManifest: JSON.stringify(manifest) }).ok, true);
  assert.equal(JSON.parse(doc.xmpMetadata.rawData).unrelated, 'keep me'); assert.deepEqual(h.rpc('readManifest', { documentID: doc.id }).value, manifest);
  assert.equal(h.calls.some(call => call[0] === 'save'), false);
  const before = doc.xmpMetadata.rawData;
  assert.equal(h.rpc('writeManifest', { documentID: doc.id, manifest, namespaceUri: 'other' }).error.code, 'PSD2UI_XMP_NAMESPACE_MISMATCH'); assert.equal(doc.xmpMetadata.rawData, before);
  assert.equal(h.rpc('setXmp', { documentId: doc.id, xmp: '{}' }).ok, true); assert.equal(doc.xmpMetadata.rawData, '{}');
});

test('group rejects disjoint selection before mutation and keeps valid layer order', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
  const ids = doc.layers.map(layer => layer.id); h.calls.length = 0;
  assert.equal(h.rpc('group', { documentId: doc.id, layerIds: [ids[0], ids[2]], name: 'Broken' }).error.code, 'PSD2UI_NONCONTIGUOUS_GROUP'); assert.deepEqual(h.calls, []);
  const response = h.rpc('group', { documentId: doc.id, layerIds: [ids[1], ids[0]], name: 'Button' });
  assert.equal(response.ok, true); assert.equal(doc.layers[0].name, 'Button'); assert.deepEqual(doc.layers[0].layers.map(layer => layer.id), ids.slice(0, 2));
  assert.equal(doc.layers[0].blendMode, 'BlendMode.PASSTHROUGH'); assert.equal(doc.layers[1].id, ids[2]);
});

test('same-document duplicate retains original parent and does not send an implicit target document', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ name: 'Group', children: [{ name: 'Nested' }] }] });
  const group = doc.layers[0], layer = group.layers[0];
  assert.equal(h.rpc('duplicate', { documentId: doc.id, layerId: layer.id }).ok, true);
  assert.equal(group.layers.length, 2); assert.equal(doc.layers.length, 1);
  assert.deepEqual(h.calls.find(call => call[0] === 'duplicateLayer').slice(2), [undefined, undefined]);
});

test('pixel export uses an independent document and restores source on failure', () => {
  for (const failSavePng of [false, true]) {
    const h = harness({ failSavePng }), doc = h.createDocument({ path: 'F:/Art/Source.psd', mode: 'CMYK', depth: 16, profile: 'CMYK profile' });
    const other = h.createDocument({ name: 'Other' });
    const response = h.rpc('exportPixels', { documentID: doc.id, path: 'F:/Temp/pixels.png', colorProfile: 'sRGB IEC61966-2.1' });
    assert.equal(response.ok, !failSavePng); assert.equal(doc.mode, 'CMYK'); assert.equal(doc.bitsPerChannel, 16); assert.equal(doc.colorProfileName, 'CMYK profile');
    assert.equal(h.app.activeDocument, other); assert.deepEqual(h.app.documents.map(item => item.id), [doc.id, other.id]);
    assert.equal(h.calls.filter(call => ['changeMode', 'convertProfile', 'close', 'savePng'].includes(call[0])).some(call => call[1] === doc.id), false);
    if (!failSavePng) assert.equal(response.value.colorProfile, 'sRGB IEC61966-2.1');
  }
});

test('single-call layer PNG export isolates each resource and returns only restored document headers', () => {
  const h = harness({ version: '21.2.3', rejectScopedHistory: true });
  const doc = h.createDocument({ path: 'F:/Art/Source.psd', width: 720, height: 1560,
    layers: [{ name: 'Hidden', visible: false, opacity: 25, bounds: [-8, 17, 24, 49] }] });
  const other = h.createDocument({ name: 'Other' });
  const before = { bounds: [...doc.layers[0].bounds], selected: [...doc.selected], xmp: doc.xmpMetadata.rawData };
  const added = [], add = h.app.documents.add;
  h.app.documents.add = (...args) => { const workbench = add(...args); added.push(workbench); return workbench; };
  for (let index = 0; index < 2; index++) {
    const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
      expectedHistoryId: 1, sourceBounds: { left: -8, top: 17 }, path: `F:/Temp/resource-${index}.png`, compression: 6 });
    assert.equal(response.ok, true, JSON.stringify(response));
    const value = response.value, workbench = added[index], copied = workbench.layers[0];
    assert.equal(value.documentId, doc.id); assert.equal(value.layerId, doc.layers[0].id);
    assert.equal(value.closed, true); assert.equal(value.activeDocumentId, doc.id);
    assert.equal(value.temporaryDocumentId, workbench.id); assert.equal(value.width, 720); assert.equal(value.height, 1560);
    assert.deepEqual(value.stamp.documents.map(item => item.id), [doc.id, other.id]);
    assert.equal(value.stamp.documents.some(item => Object.hasOwn(item, 'layers')), false);
    assert.equal(copied.visible, true); assert.equal(copied.opacity, 100);
    assert.deepEqual(copied.bounds, [0, 0, 32, 32]);
    assert.equal(h.calls.some(call => call[0] === 'trim' && call[1] === workbench.id), true);
    assert.equal(h.files.has(`F:/Temp/resource-${index}.png`), true);
  }
  assert.notEqual(added[0].id, added[1].id);
  assert.equal(doc.layers[0].visible, false); assert.equal(doc.layers[0].opacity, 25);
  assert.deepEqual(doc.layers[0].bounds, before.bounds); assert.deepEqual(doc.selected, before.selected);
  assert.equal(doc.xmpMetadata.rawData, before.xmp); assert.equal(h.app.activeDocument, doc);
  assert.deepEqual(h.app.documents.map(item => item.id), [doc.id, other.id]);
  assert.equal(h.calls.some(call => ['save', 'savePng', 'close', 'trim', 'translate'].includes(call[0]) && call[1] === doc.id), false);
});

test('layer export rejects stale source history before creating a document or writing a PNG', () => {
  const h = harness(), doc = h.createDocument(); doc.historyId = 7;
  for (const expectedHistoryId of [undefined, 6]) {
    const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
      expectedHistoryId, sourceBounds: { left: 2, top: 3 }, path: 'F:/Temp/stale.png' });
    assert.equal(response.ok, false); assert.equal(response.error.code, 'PSD2UI_STATE_CHANGED');
    assert.deepEqual(Array.from(h.app.documents), [doc]); assert.equal(h.files.size, 0);
    assert.equal(h.calls.some(call => ['duplicateLayer', 'savePng', 'close'].includes(call[0])), false);
  }
});

test('layer export closes only its owned workbench after duplicate, translate, trim or save failure', () => {
  for (const stage of ['duplicate', 'translate', 'trim', 'save']) {
    const h = harness({ failSavePng: stage === 'save' }), doc = h.createDocument({ path: 'F:/Art/Source.psd' });
    const other = h.createDocument({ path: 'F:/Art/Other.psd' }), add = h.app.documents.add;
    const duplicate = doc.layers[0].duplicate;
    doc.layers[0].duplicate = function (...args) {
      if (stage === 'duplicate') throw new Error('Injected duplicate failure');
      const copied = duplicate.apply(this, args);
      if (stage === 'translate') copied.translate = () => { throw new Error('Injected translate failure'); };
      return copied;
    };
    h.app.documents.add = (...args) => {
      const result = add(...args);
      if (stage === 'trim') result.trim = () => { throw new Error('Injected trim failure'); };
      return result;
    };
    const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
      expectedHistoryId: 1, sourceBounds: { left: 2, top: 3 }, path: 'F:/Temp/failed.png' });
    assert.equal(response.ok, false, stage);
    assert.deepEqual(h.app.documents.map(item => item.id), [doc.id, other.id]); assert.equal(h.app.activeDocument, doc);
    assert.equal(h.calls.filter(call => call[0] === 'close').length, 1);
    assert.equal(h.calls.some(call => call[0] === 'close' && [doc.id, other.id].includes(call[1])), false);
  }
});

test('layer export never modifies or closes a reused document or a returned source-layer alias', () => {
  for (const alias of ['document', 'layer']) {
    const h = harness(), doc = h.createDocument({ layers: [{ visible: false, opacity: 25 }] });
    if (alias === 'document') h.app.documents.add = () => doc;
    else doc.layers[0].duplicate = () => doc.layers[0];
    const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
      expectedHistoryId: 1, sourceBounds: { left: 2, top: 3 }, path: 'F:/Temp/alias.png' });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, alias === 'document' ? 'PSD2UI_TEMP_DOCUMENT_CREATE_FAILED' : 'PSD2UI_TEMP_LAYER_MISMATCH');
    assert.equal(doc.layers[0].visible, false); assert.equal(doc.layers[0].opacity, 25);
    assert.deepEqual(Array.from(h.app.documents), [doc]); assert.equal(h.files.size, 0);
    assert.equal(h.calls.some(call => call[0] === 'close' && call[1] === doc.id), false);
  }
});

test('layer export restores source and reports failure when workbench cleanup fails', () => {
  const h = harness(), doc = h.createDocument(), add = h.app.documents.add;
  h.app.documents.add = (...args) => {
    const workbench = add(...args); workbench.close = () => { throw new Error('Injected close failure'); }; return workbench;
  };
  const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
    expectedHistoryId: 1, sourceBounds: { left: 2, top: 3 }, path: 'F:/Temp/cleanup.png' });
  assert.equal(response.ok, false); assert.match(response.error.message, /Injected close failure/);
  assert.equal(h.app.activeDocument, doc); assert.equal(h.app.documents.includes(doc), true);
});

test('layer export translates by supplied AM bounds without reading different DOM bounds', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ bounds: [100, 200, 116, 216] }] });
  const layer = doc.layers[0]; let domReads = 0, copied;
  Object.defineProperty(layer, 'bounds', { get() { domReads++; throw new Error('DOM bounds must not be read during export'); } });
  // Photoshop 的原生复制无需通过脚本访问源图层 DOM bounds。
  layer.duplicate = destination => {
    copied = destination.layers[0]; copied.bounds = [100, 200, 116, 216]; copied.boundsNoEffects = copied.bounds; return copied;
  };
  const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: layer.id, expectedHistoryId: 1,
    sourceBounds: { left: 8.5, top: -9 }, path: 'F:/Temp/am-bounds.png' });
  assert.equal(response.ok, true, JSON.stringify(response)); assert.equal(domReads, 0);
  assert.deepEqual(h.calls.find(call => call[0] === 'translate'), ['translate', copied.id, -8.5, 9]);
  assert.deepEqual(copied.bounds, [91.5, 209, 107.5, 225]);
  assert.equal(h.app.activeDocument, doc); assert.deepEqual(Array.from(h.app.documents), [doc]);
});

test('layer export requires nonempty finite source bounds before activation or writes', () => {
  for (const sourceBounds of [undefined, null, {}, { left: 0 }, { left: null, top: 0 }, { left: 0, top: '' },
    { left: '1', top: 0 }, { left: false, top: 0 }, { left: NaN, top: 0 }, { left: 0, top: Infinity }]) {
    const h = harness(), doc = h.createDocument(), other = h.createDocument();
    const response = h.rpc('exportLayerPng', { documentId: doc.id, layerId: doc.layers[0].id,
      expectedHistoryId: 1, sourceBounds, path: 'F:/Temp/invalid-bounds.png' });
    assert.equal(response.ok, false); assert.equal(response.error.code, 'PSD2UI_INVALID_ARGUMENT');
    assert.equal(h.app.activeDocument, other); assert.equal(h.calls.length, 0); assert.equal(h.files.size, 0);
    assert.deepEqual(Array.from(h.app.documents), [doc, other]);
  }
});

test('pixel import preserves transparent canvas padding and only replaces an owned output layer', () => {
  const h = harness(), sourceDoc = h.createDocument({ path: 'F:/Art/Source.psd' });
  h.files.set('F:/Temp/pixels.png', { width: 32, height: 32, layers: [{ bounds: [7, 9, 20, 22] }] });
  assert.equal(h.rpc('importPixels', { documentID: sourceDoc.id, layerID: sourceDoc.layers[0].id, path: 'F:/Temp/pixels.png' }).error.code, 'PSD2UI_DOCUMENT_NOT_TEMPORARY');
  const created = h.rpc('addDocument', { name: 'PSD2UI_NineSlice_Output', width: 32, height: 32 }).value;
  const output = h.app.documents.find(doc => doc.id === created.id), oldId = output.layers[0].id;
  output.colorProfileName = 'Adobe RGB (1998)';
  const response = h.rpc('importPixels', { documentID: output.id, layerID: oldId, path: 'F:/Temp/pixels.png', replace: true, colorProfile: 'sRGB IEC61966-2.1', targetBounds: { left: 0, top: 0, width: 32, height: 32 } });
  assert.equal(response.ok, true); assert.notEqual(response.value.layerId, oldId); assert.equal(output.layers.length, 1);
  assert.deepEqual(output.layers[0].bounds, [7, 9, 20, 22]); assert.equal(h.app.documents.length, 2); assert.equal(h.app.documents[0], sourceDoc);
  assert.equal(output.colorProfileName, 'sRGB IEC61966-2.1');
});

test('pixel import refuses an unexpected reused document ID and never closes that document', () => {
  const h = harness(), existing = h.createDocument({ name: 'Artist.png', path: 'F:/Art/Artist.png' });
  h.files.set('F:/Temp/Alias.png', { width: 32, height: 32 });
  const outputId = h.rpc('addDocument', { name: 'PSD2UI_NineSlice_Output', width: 32, height: 32 }).value.id;
  const output = h.app.documents.find(doc => doc.id === outputId);
  h.app.open = () => existing;
  const response = h.rpc('importPixels', { documentId: outputId, layerId: output.layers[0].id, path: 'F:/Temp/Alias.png' });
  assert.equal(response.error.code, 'PSD2UI_TEMP_DOCUMENT_CREATE_FAILED');
  assert.equal(h.app.documents.includes(existing), true); assert.equal(h.calls.some(call => call[0] === 'close'), false);
});

test('move, ungroup and delete keep layer IDs and refuse cycles or foreign anchors', () => {
  const h = harness(), doc = h.createDocument({ layers: [{ name: 'Group', children: [{ name: 'Child' }] }, { name: 'Other' }] });
  const group = doc.layers[0], child = group.layers[0], other = doc.layers[1], initialBounds = [...child.bounds];
  assert.equal(h.rpc('move', { documentID: doc.id, layerID: group.id, parentID: group.id }).error.code, 'PSD2UI_MOVE_CYCLE');
  assert.equal(h.rpc('move', { documentID: doc.id, layerID: child.id, parentID: 'document-root', beforeID: other.id }).ok, true);
  assert.equal(child.parent, doc); assert.deepEqual(child.bounds, initialBounds); assert.deepEqual(doc.layers.map(layer => layer.id), [group.id, child.id, other.id]);
  assert.equal(h.rpc('move', { documentID: doc.id, layerID: child.id, parentID: group.id }).ok, true);
  assert.equal(h.calls.filter(call => call[0] === 'move').slice(-1)[0][3], 'PLACEATBEGINNING');
  assert.deepEqual(h.rpc('ungroup', { documentID: doc.id, layerID: group.id }).value.childIds, [child.id]);
  assert.equal(doc.layers[0], child); assert.equal(h.rpc('delete', { documentID: doc.id, layerID: other.id }).ok, true); assert.deepEqual(doc.layers.map(layer => layer.id), [child.id]);
});

test('visibility RPC reads only visibility and ancestor bounds, returns no full snapshot and rejects stale stamps', () => {
  const h = harness();
  const doc = h.createDocument({ layers: [{ name: 'Group', children: [{ name: 'Child' }] }, { name: 'Untouched' }] });
  const group = doc.layers[0], child = group.layers[0];
  const begin = h.rpc('beginState');
  let page; do { page = h.rpc('statePage', { token: begin.value.token }); assert.equal(page.ok, true); } while (!page.value.done);
  child.visible = false;
  Object.defineProperty(doc.xmpMetadata, 'rawData', { get() { throw new Error('visibility must not read XMP'); } });
  const stamp = h.rpc('probe').value;
  const result = h.rpc('readVisibility', { documentId: doc.id, layerIds: [child.id, group.id], groupIds: [group.id], stamp });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.equal(result.state, null);
  assert.equal(result.value.layers[0].visible, false);
  assert.deepEqual(result.value.layers[1].bounds, { left: 2, top: 3, right: 18, bottom: 19 });
  assert.equal(result.value.layers[0].descriptor, undefined);
  child.name = 'Renamed';
  const renamed = h.rpc('readVisibility', { documentId: doc.id, layerIds: [child.id], names: true, stamp });
  assert.equal(renamed.value.layers[0].name, 'Renamed');
  stamp.documents[0].historyId = 'stale';
  const stale = h.rpc('readVisibility', { documentId: doc.id, layerIds: [child.id], stamp });
  assert.equal(stale.ok, false); assert.equal(stale.error.code, 'PSD2UI_STATE_CHANGED');
  assert.equal(stale.state, null);
});

test('slow state probes cannot consume the page budget and produce endless empty pages', () => {
  let elapsed = 0;
  function SlowClock() { this.getTime = () => { elapsed += 100; return elapsed; }; }
  const h = harness({ clock: SlowClock });
  const doc = h.createDocument({ layers: [{ name: 'First' }, { name: 'Second' }] });
  const begin = h.rpc('beginState');
  const first = h.rpc('statePage', { token: begin.value.token });
  assert.equal(first.ok, true);
  assert.equal(first.value.items.length, 1, 'a slow initial probe must still allow one layer');
  const second = h.rpc('statePage', { token: begin.value.token });
  assert.equal(second.value.items.length, 1);
  const last = h.rpc('statePage', { token: begin.value.token });
  assert.equal(last.value.done, true);
});
