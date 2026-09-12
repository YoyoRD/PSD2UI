'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStorage, nativePathFromUrl } = require('../../Plus-ins/PSD2UI-CEP/src/storage');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psd2ui-cep-storage-test-'));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    assert.match(path.basename(root), /^psd2ui-cep-storage-test-/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('storage writes UTF-8 and exact binary buffers, and requires explicit overwrite', async t => {
  const root = workspace(t);
  const storage = createStorage({ temporaryBase: root });
  const folder = await storage.localFileSystem.getEntryWithUrl(root);
  const file = await folder.createFile('界面 100%.json');
  await file.write('中文镜像\n');
  assert.equal(await file.read(), '中文镜像\n');
  await assert.rejects(folder.createFile(file.name), { code: 'EEXIST' });
  assert.equal(await file.read(), '中文镜像\n', 'failed create must not truncate existing output');
  const binary = await folder.createFile('pixel.png');
  const buffer = Buffer.from([99, 0, 127, 255, 88]);
  await binary.write(buffer.subarray(1, 4), { format: storage.formats.binary });
  assert.deepEqual([...new Uint8Array(await binary.read({ format: storage.formats.binary }))], [0, 127, 255]);
  await folder.createFile(file.name, { overwrite: true });
  assert.equal(await file.read(), '');
});

test('storage preserves paths and bytes during staged copies and backup restore', async t => {
  const root = workspace(t);
  const storage = createStorage();
  const folder = await storage.localFileSystem.getEntryWithUrl(root);
  const staged = await folder.createFolder('staged');
  const destination = await folder.createFolder('published');
  const backup = await folder.createFolder('backup');
  const old = await destination.createFile('module_sp_button.png');
  await old.write(new Uint8Array([4, 3, 2, 1]), { format: storage.formats.binary });
  const copy = await old.copyTo(backup);
  const fresh = await staged.createFile(old.name);
  await fresh.write(new Uint8Array([8, 7]), { format: storage.formats.binary });
  await assert.rejects(fresh.copyTo(destination), { code: 'EEXIST' });
  await fresh.copyTo(destination, { overwrite: true });
  assert.deepEqual([...new Uint8Array(await old.read({ format: storage.formats.binary }))], [8, 7]);
  await copy.copyTo(destination, { overwrite: true });
  assert.deepEqual([...new Uint8Array(await old.read({ format: storage.formats.binary }))], [4, 3, 2, 1]);
  await staged.delete();
  assert.equal(fs.existsSync(staged.nativePath), false);
  await assert.rejects(folder.delete(), /DELETE_ROOT/);
  assert.equal(fs.existsSync(old.nativePath), true);
});

test('storage rejects traversal and symlink destinations before writes or recursive deletion', async t => {
  const root = workspace(t);
  const storage = createStorage();
  const folder = await storage.localFileSystem.getEntryWithUrl(root);
  for (const invalid of ['../outside', '..', 'nested/image.png', 'nested\\image.png', 'C:\\outside', 'NUL', 'trailing.']) {
    await assert.rejects(folder.createFile(invalid), /ENTRY_NAME_INVALID/);
    await assert.rejects(folder.createFolder(invalid), /ENTRY_NAME_INVALID/);
  }
  const source = await folder.createFolder('source');
  const target = await folder.createFolder('target');
  const file = await source.createFile('value.txt');
  await file.write('preserve');
  const link = path.join(target.nativePath, 'value.txt');
  try { fs.symlinkSync(file.nativePath, link, 'file'); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.diagnostic('OS does not permit file symlink creation. Traversal checks passed.'); return; }
    throw error;
  }
  await assert.rejects(file.copyTo(target, { overwrite: true }), /PATH_LINK/);
  await assert.rejects(target.delete(), /PATH_LINK/);
  assert.equal(await file.read(), 'preserve');
});

test('directory tokens restore only existing paths; picker cancellation and temp isolation are preserved', async t => {
  const root = workspace(t);
  const storage = createStorage({ temporaryBase: root, pickFolder: () => root });
  const chosen = await storage.localFileSystem.getFolder();
  const token = await storage.localFileSystem.createPersistentToken(chosen);
  assert.equal((await storage.localFileSystem.getEntryForPersistentToken(token)).nativePath, chosen.nativePath);
  await assert.rejects(storage.localFileSystem.getEntryForPersistentToken('uxp:old-token'), /记录无效/);
  assert.equal(await createStorage({ pickFolder: () => null }).localFileSystem.getFolder(), null);
  const temp = await storage.localFileSystem.getTemporaryFolder();
  assert.equal(await storage.localFileSystem.getTemporaryFolder(), temp);
  assert.equal(path.dirname(temp.nativePath), root);
  assert.match(temp.name, /^psd2ui-cep-/);
  assert.equal(nativePathFromUrl('file:' + root), root);
  assert.throws(() => nativePathFromUrl('https://example.test/image.png'), /FILE_URL_INVALID/);
  assert.throws(() => nativePathFromUrl('../relative'), /FILE_PATH_INVALID/);
});
