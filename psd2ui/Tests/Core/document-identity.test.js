'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { bindDocumentIdentity } = require('../../Core/documentIdentity');

test('copied PSD changes only document identity and name, keeping authoring content', () => {
  const manifest = { document: { id: 'original-id', name: 'X选服-一键生成',
    sourcePath: 'f:/art/x选服-一键生成.psd', module: 'alert' }, nodes: { root: { semantic: 'view' } } };
  const result = bindDocumentIdentity(manifest,
    { name: 'X选服-提示-一键生成', path: 'F:\\Art\\X选服-提示-一键生成.psd' },
    { idFactory: () => 'copy-id' });
  assert.equal(result.manifest.document.id, 'copy-id');
  assert.equal(result.manifest.document.name, 'X选服-提示-一键生成');
  assert.equal(result.manifest.document.sourcePath, 'f:/art/x选服-提示-一键生成.psd');
  assert.strictEqual(result.manifest.nodes, manifest.nodes);
  assert.equal(manifest.document.id, 'original-id');
  assert.strictEqual(bindDocumentIdentity(result.manifest,
    { name: 'X选服-提示-一键生成', path: 'f:/art/X选服-提示-一键生成.psd' }).manifest, result.manifest);
});

test('legacy manifest with a different PSD filename receives a new identity', () => {
  const manifest = { document: { id: 'old-id', name: '旧页面' }, nodes: {} };
  const result = bindDocumentIdentity(manifest, { name: '新页面', path: 'F:/Art/新页面.psd' },
    { idFactory: () => 'new-id' });
  assert.equal(result.manifest.document.id, 'new-id');
  assert.equal(result.manifest.document.name, '新页面');
});

test('a copied PSD with the same filename also receives a new identity', () => {
  const manifest = { document: { id: 'old-id', name: '页面', sourcePath: 'f:/art/页面.psd' }, nodes: {} };
  const result = bindDocumentIdentity(manifest, { name: '页面', path: 'F:/Art/副本/页面.psd' },
    { idFactory: () => 'copy-id' });
  assert.equal(result.manifest.document.id, 'copy-id');
  assert.equal(result.manifest.document.name, '页面');
});

test('legacy original keeps its ID when first bound to its existing PSD path', () => {
  const manifest = { document: { id: 'old-id', name: '原页面' }, nodes: {} };
  const result = bindDocumentIdentity(manifest, { name: '原页面', path: 'F:/Art/原页面.psd' });
  assert.equal(result.manifest.document.id, 'old-id');
  assert.equal(result.manifest.document.sourcePath, 'f:/art/原页面.psd');
});
