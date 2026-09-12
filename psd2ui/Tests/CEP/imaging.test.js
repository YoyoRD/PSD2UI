'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PNG = require('pngjs').PNG;
const { createStorage } = require('../../Plus-ins/PSD2UI-CEP/src/storage');
const { createImaging } = require('../../Plus-ins/PSD2UI-CEP/src/imaging');
const { collapseNineSlicePixels } = require('../../Core/nineSlice');

function harness(t, document, config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psd2ui-cep-imaging-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^psd2ui-cep-imaging-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const storage = createStorage({ temporaryBase: root });
  const calls = [];
  let imported = null;
  let importedBytes = null;
  const imaging = createImaging({ storage, async invoke(method, payload) {
    calls.push({ method, payload });
    if (config.fail) throw new Error('simulated host error');
    if (method === 'exportPixels') {
      const bytes = config.exportedPNG || PNG.sync.write(document, { colorType: 6, inputColorType: 6 });
      fs.writeFileSync(payload.path, bytes);
      return { path: payload.path, width: document.width, height: document.height,
        colorSpace: 'RGB', colorProfile: config.reportedProfile || payload.colorProfile || 'sRGB IEC61966-2.1' };
    }
    if (method === 'importPixels') {
      importedBytes = fs.readFileSync(payload.path);
      imported = PNG.sync.read(importedBytes);
      return { layerId: 900 };
    }
    throw new Error('unexpected RPC ' + method);
  } });
  return { imaging, calls, storage, imported: () => imported, importedBytes: () => importedBytes };
}

function rgba(width, height, pixel) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}

test('getPixels preserves semi-transparent RGB, trims actual bounds, and clips sourceBounds', async t => {
  const h = harness(t, rgba(5, 4, (x, y) => x >= 1 && x <= 3 && y >= 1 && y <= 2 ? [21 + x, 45, 67, x === 2 ? 128 : 255] : [200, 100, 50, 0]));
  const result = await h.imaging.getPixels({ documentID: 42, componentSize: 8,
    sourceBounds: { left: 2, top: 0, width: 10, height: 9 }, colorProfile: 'sRGB IEC61966-2.1', applyAlpha: false });
  assert.deepEqual(result.sourceBounds, { left: 2, top: 1, right: 4, bottom: 3 });
  assert.equal(result.imageData.width, 2);
  assert.equal(result.imageData.height, 2);
  assert.deepEqual([...await result.imageData.getData()], [23, 45, 67, 128, 24, 45, 67, 255, 23, 45, 67, 128, 24, 45, 67, 255]);
  assert.equal((await (await h.storage.localFileSystem.getTemporaryFolder()).getEntries()).length, 0);
  result.imageData.dispose();
  await assert.rejects(result.imageData.getData(), /已释放/);
});

test('nine-slice roundtrip keeps corner and alpha pixels with explicit sRGB metadata', async t => {
  const source = rgba(8, 7, (x, y) => [x * 20, y * 20, x + y, (x + y) % 2 ? 128 : 255]);
  const h = harness(t, source);
  const captured = await h.imaging.getPixels({ documentID: 42, componentSize: 8 });
  const collapsed = collapseNineSlicePixels(await captured.imageData.getData(), 8, 7, 4,
    { left: 2, top: 1, right: 2, bottom: 1 });
  const data = await h.imaging.createImageDataFromBuffer(collapsed.pixels, {
    width: collapsed.width, height: collapsed.height, components: 4,
    colorSpace: 'RGB', colorProfile: captured.imageData.colorProfile
  });
  assert.deepEqual(await h.imaging.putPixels({ documentID: 81, layerID: 82, imageData: data, replace: true,
    targetBounds: { left: 0, top: 0, width: 5, height: 3 } }), { layerId: 900 });
  assert.equal(h.imported().width, 5);
  assert.equal(h.imported().height, 3);
  assert.deepEqual([...h.imported().data], [...collapsed.pixels]);
  assert.ok(h.importedBytes().includes(Buffer.from('sRGB')));
  assert.equal(h.calls[1].payload.colorProfile, 'sRGB IEC61966-2.1');
  assert.equal((await (await h.storage.localFileSystem.getTemporaryFolder()).getEntries()).length, 0);
});

test('RGB writes gain opaque alpha; transparent padding is not shifted during putPixels', async t => {
  const h = harness(t, rgba(1, 1, () => [1, 2, 3, 255]));
  const data = await h.imaging.createImageDataFromBuffer(new Uint8Array([9, 8, 7, 1, 2, 3]),
    { width: 2, height: 1, components: 3, colorSpace: 'RGB', colorProfile: 'Adobe RGB (1998)' });
  await h.imaging.putPixels({ documentID: 10, layerID: 11, imageData: data });
  assert.deepEqual([...h.imported().data], [9, 8, 7, 255, 1, 2, 3, 255]);
  assert.equal(h.calls[0].payload.colorProfile, 'Adobe RGB (1998)', 'unknown ICC must be passed to host, not relabeled sRGB');
  const padded = await h.imaging.createImageDataFromBuffer(new Uint8Array([5, 6, 7, 0, 8, 9, 10, 128]),
    { width: 2, height: 1, components: 4, colorSpace: 'RGB' });
  await h.imaging.putPixels({ documentID: 10, layerID: 11, imageData: padded });
  assert.equal(h.imported().width, 2);
  assert.deepEqual([...h.imported().data], [5, 6, 7, 0, 8, 9, 10, 128]);
});

test('embedded ICC bytes survive decoding, nine-slice buffer creation, and PNG re-encoding', async t => {
  const document = rgba(3, 3, (x, y) => [50 + x, 70 + y, 90, 128]);
  const original = PNG.sync.write(document, { colorType: 6, inputColorType: 6 });
  // The codec must treat ICC as opaque data, never reinterpret pixels using a guessed working profile.
  const profile = Buffer.concat([Buffer.from('Artist ICC\0\0'), require('node:zlib').deflateSync(Buffer.from('opaque ICC fixture'))]);
  const chunk = Buffer.alloc(profile.length + 12);
  chunk.writeUInt32BE(profile.length, 0);
  chunk.write('iCCP', 4);
  profile.copy(chunk, 8);
  chunk.writeUInt32BE(require('pngjs/lib/crc').crc32(chunk.subarray(4, profile.length + 8)) >>> 0, profile.length + 8);
  const exportedPNG = Buffer.concat([original.subarray(0, 33), chunk, original.subarray(33)]);
  const h = harness(t, document, { exportedPNG, reportedProfile: 'Artist ICC' });
  const captured = await h.imaging.getPixels({ documentID: 42 });
  const collapsed = collapseNineSlicePixels(await captured.imageData.getData(), 3, 3, 4,
    { left: 0, right: 0, top: 0, bottom: 0 });
  const data = await h.imaging.createImageDataFromBuffer(collapsed.pixels,
    { width: 1, height: 1, components: 4, colorSpace: 'RGB', colorProfile: 'Artist ICC' });
  await h.imaging.putPixels({ documentID: 81, layerID: 82, imageData: data });
  assert.ok(h.importedBytes().includes(chunk), 'iCCP chunk must survive byte-for-byte');
  assert.equal(h.importedBytes().includes(Buffer.from('sRGB')), false, 'custom profile must not gain an sRGB declaration');
  assert.deepEqual([...h.imported().data], [...collapsed.pixels]);
});

test('unsupported depth and profile mismatch fail explicitly; temporary pixels are cleaned after host failure', async t => {
  const document = rgba(1, 1, () => [10, 20, 30, 255]);
  const h = harness(t, document, { fail: true });
  await assert.rejects(h.imaging.getPixels({ componentSize: 16 }), /IMAGING_UNSUPPORTED/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.imaging.getPixels({ documentID: 7 }), /simulated host error/);
  assert.equal((await (await h.storage.localFileSystem.getTemporaryFolder()).getEntries()).length, 0);
  await assert.rejects(h.imaging.createImageDataFromBuffer(new Uint16Array(4), { width: 1, height: 1, components: 4 }), /8-bit/);
  const mismatch = harness(t, document, { reportedProfile: 'Adobe RGB (1998)' });
  await assert.rejects(mismatch.imaging.getPixels({ documentID: 7, colorProfile: 'sRGB IEC61966-2.1' }), /色彩配置不符/);
});

test('fully transparent requested regions remain empty rather than opaque white or invented pixels', async t => {
  const h = harness(t, rgba(4, 4, () => [1, 2, 3, 0]));
  const result = await h.imaging.getPixels({ sourceBounds: { left: 1, top: 2, width: 2, height: 2 } });
  assert.deepEqual(result.sourceBounds, { left: 1, top: 2, right: 1, bottom: 2 });
  assert.equal(result.imageData.width, 0);
  assert.equal(result.imageData.height, 0);
  assert.equal((await result.imageData.getData()).length, 0);
});
