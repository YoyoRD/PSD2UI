'use strict';

function number(value, fallback) {
  if (value == null) return fallback;
  const candidate = value && typeof value === 'object' && value._value != null
    ? Number(value._value)
    : Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function color(value, opacityPercent) {
  if (!value) return null;
  const red = number(value.red, NaN);
  const green = number(value.green != null ? value.green : value.grain, NaN);
  const blue = number(value.blue, NaN);
  if (![red, green, blue].every(Number.isFinite)) return null;
  return {
    r: clamp01(red / 255),
    g: clamp01(green / 255),
    b: clamp01(blue / 255),
    a: clamp01(number(opacityPercent, 100) / 100)
  };
}

function effectEnabled(value) {
  return Boolean(value) && value.enabled !== false && value.present !== false;
}

function firstEnabled(effects, name) {
  const direct = effects && effects[name];
  if (Array.isArray(direct)) return direct.find(effectEnabled) || null;
  if (effectEnabled(direct)) return direct;
  const multi = effects && effects[`${name}Multi`];
  return Array.isArray(multi) ? multi.find(effectEnabled) || null : null;
}

function normalizedTime(value) {
  return clamp01(number(value, 0) / 4096);
}

function normalizeGradient(effect) {
  if (!effect) return null;
  const gradient = effect.gradient || {};
  const opacity = number(effect.opacity, 100) / 100;
  const colorKeys = (gradient.colors || []).map((entry) => ({
    time: normalizedTime(entry.location),
    color: color(entry.color, 100)
  })).filter((entry) => entry.color).sort((left, right) => left.time - right.time);
  if (colorKeys.length < 2) return null;

  let alphaKeys = (gradient.transparency || []).map((entry) => ({
    time: normalizedTime(entry.location),
    alpha: clamp01(number(entry.opacity, 100) / 100 * opacity)
  })).sort((left, right) => left.time - right.time);
  if (alphaKeys.length < 2) {
    alphaKeys = [
      { time: 0, alpha: clamp01(opacity) },
      { time: 1, alpha: clamp01(opacity) }
    ];
  }
  const angle = number(effect.angle, 90) * Math.PI / 180;
  return {
    isVertical: Math.abs(Math.sin(angle)) >= Math.abs(Math.cos(angle)),
    colorKeys,
    alphaKeys
  };
}

function normalizeOutline(effect) {
  if (!effect) return null;
  const effectColor = color(effect.color, number(effect.opacity, 100));
  if (!effectColor) return null;
  const size = Math.max(0, number(effect.size, 0));
  return { color: effectColor, distanceX: size, distanceY: size };
}

function normalizeShadow(effect, globalAngle) {
  if (!effect) return null;
  const effectColor = color(effect.color, number(effect.opacity, 100));
  if (!effectColor) return null;
  const distance = Math.max(0, number(effect.distance, 0));
  const angle = number(effect.useGlobalAngle && globalAngle != null ? globalAngle
    : effect.localLightingAngle != null ? effect.localLightingAngle : effect.angle, 90) * Math.PI / 180;
  return {
    color: effectColor,
    distanceX: -Math.cos(angle) * distance,
    distanceY: -Math.sin(angle) * distance
  };
}

function normalizeLayerTextEffects(layerEffects, context = {}) {
  if (context.layerFXVisible === false) return null;
  if (!layerEffects || typeof layerEffects !== 'object') return null;
  const result = {
    gradient: normalizeGradient(firstEnabled(layerEffects, 'gradientFill')),
    outline: normalizeOutline(firstEnabled(layerEffects, 'frameFX')),
    shadow: normalizeShadow(firstEnabled(layerEffects, 'dropShadow'), context.globalAngle)
  };
  return result.gradient || result.outline || result.shadow ? result : null;
}

module.exports = { normalizeLayerTextEffects };
