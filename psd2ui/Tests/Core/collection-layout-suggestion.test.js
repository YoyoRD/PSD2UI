'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestCollectionLayout, planCollectionLayout } = require('../../Core');
const cell = (layerId, left, top, width = 75, height = 74) => ({ layerId, name: `Cell${layerId}`, kind: 'group',
  bounds: { left, top, right: left + width, bottom: top + height }, children: [] });

test('Grid automatically measures an incomplete last row and reports averaged uneven spacing', () => {
  const samples = [cell(1, 68, 353), cell(2, 152, 353), cell(3, 228, 353), cell(4, 68, 433)];
  const before = structuredClone(samples);
  const result = suggestCollectionLayout('grid', samples);
  assert.deepEqual(result.layout, { cellWidth: 75, cellHeight: 74, columns: 3, rows: 2,
    horizontalSpacing: 5, verticalSpacing: 6 });
  assert.equal(result.diagnostics.length, 1);
  assert.match(result.diagnostics[0].message, /1–9px.*5px/);
  assert.deepEqual(samples, before);
  assert.throws(() => planCollectionLayout('grid', samples), error => error.code === 'PSD2UI_STRUCTURE_SPACING_MISMATCH');
});

test('regular grids and single-axis samples need no correction, and lists support measured spacing', () => {
  const vertical = suggestCollectionLayout('grid', [cell(1, 0, 0), cell(2, 0, 80)]);
  assert.deepEqual(vertical.layout, { cellWidth: 75, cellHeight: 74, columns: 1, rows: 2,
    horizontalSpacing: 0, verticalSpacing: 6 });
  assert.deepEqual(vertical.diagnostics, []);
  const horizontal = suggestCollectionLayout('grid', [cell(1, 0, 0), cell(2, 80, 0)]);
  assert.equal(horizontal.layout.rows, 1);
  assert.equal(horizontal.layout.verticalSpacing, 0);
  const list = suggestCollectionLayout('list', [cell(1, 0, 0), cell(2, 0, 80), cell(3, 0, 164)]);
  assert.equal(list.layout.direction, 'vertical');
  assert.equal(list.layout.spacing, 8);
  assert.equal(list.diagnostics.length, 1);
});

test('automatic layout rejects overlapping cells, unequal sizes, grid holes and insufficient samples', () => {
  assert.throws(() => suggestCollectionLayout('grid', [cell(1, 0, 0)]), /至少两个/);
  assert.throws(() => suggestCollectionLayout('grid', [cell(1, 0, 0), cell(2, 50, 0), cell(3, 180, 0)]), /重叠/);
  assert.throws(() => suggestCollectionLayout('grid', [cell(1, 0, 0), cell(2, 80, 0, 100)]), /尺寸一致/);
  assert.throws(() => suggestCollectionLayout('grid', [cell(1, 0, 0), cell(2, 80, 0), cell(3, 80, 80)]), /按行连续/);
});
