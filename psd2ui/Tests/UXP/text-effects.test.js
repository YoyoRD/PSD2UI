'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeLayerTextEffects } = require('../../Plus-ins/PSD2UI/src/textEffects');

test('Photoshop 文本渐变、描边和阴影被归一为 YoyoUI 效果参数', () => {
  const effects = normalizeLayerTextEffects({
    gradientFill: {
      enabled: true,
      angle: { _unit: 'angleUnit', _value: 90 },
      opacity: { _unit: 'percentUnit', _value: 80 },
      gradient: {
        colors: [
          { location: 0, color: { red: 255, grain: 0, blue: 0 } },
          { location: 4096, color: { red: 0, grain: 0, blue: 255 } }
        ],
        transparency: [
          { location: 0, opacity: { _unit: 'percentUnit', _value: 100 } },
          { location: 4096, opacity: { _unit: 'percentUnit', _value: 50 } }
        ]
      }
    },
    frameFX: {
      enabled: true,
      size: { _unit: 'pixelsUnit', _value: 3 },
      opacity: { _unit: 'percentUnit', _value: 50 },
      color: { red: 0, green: 255, blue: 0 }
    },
    dropShadow: {
      enabled: true,
      distance: { _unit: 'pixelsUnit', _value: 4 },
      localLightingAngle: { _unit: 'angleUnit', _value: 90 },
      opacity: { _unit: 'percentUnit', _value: 25 },
      color: { red: 0, green: 0, blue: 0 }
    }
  });

  assert.equal(effects.gradient.isVertical, true);
  assert.equal(effects.gradient.colorKeys.length, 2);
  assert.equal(effects.gradient.alphaKeys[1].alpha, 0.4);
  assert.deepEqual(effects.outline, {
    color: { r: 0, g: 1, b: 0, a: 0.5 },
    distanceX: 3,
    distanceY: 3
  });
  assert.ok(Math.abs(effects.shadow.distanceX) < 0.000001);
  assert.equal(effects.shadow.distanceY, -4);
  assert.equal(effects.shadow.color.a, 0.25);
});

test('投影使用 PS 光源方向并解析全局光，关闭特效总开关不产生有效效果', () => {
  const dropShadow = { enabled: true, present: true, color: { red: 0, green: 0, blue: 0 },
    distance: { _value: Math.sqrt(8) }, localLightingAngle: { _value: 135 } };
  const local = normalizeLayerTextEffects({ dropShadow }).shadow;
  assert.ok(Math.abs(local.distanceX - 2) < 1e-6);
  assert.ok(Math.abs(local.distanceY + 2) < 1e-6);
  dropShadow.useGlobalAngle = true;
  const global = normalizeLayerTextEffects({ dropShadow }, { globalAngle: 0 }).shadow;
  assert.ok(Math.abs(global.distanceX + Math.sqrt(8)) < 1e-6);
  assert.ok(Math.abs(global.distanceY) < 1e-6);
  assert.equal(normalizeLayerTextEffects({ dropShadow }, { layerFXVisible: false }), null);
});
