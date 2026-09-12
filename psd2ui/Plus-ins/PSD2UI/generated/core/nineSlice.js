'use strict';

const { fail } = require('./errors');

function normalizeSliceBorder(value, width, height) {
  if (!value) return null;
  const result = {};
  for (const key of ['left', 'top', 'right', 'bottom']) {
    const number = Number(value[key]);
    if (!Number.isInteger(number) || number < 0) {
      fail('PSD2UI_SLICE_BORDER_INVALID', `九宫参数 ${key} 必须是大于或等于 0 的整数。`);
    }
    result[key] = number;
  }
  if (result.left + result.right >= width || result.top + result.bottom >= height) {
    fail(
      'PSD2UI_SLICE_BORDER_OUT_OF_RANGE',
      `九宫固定边超出图片范围：图片 ${width}×${height}，边距 ${result.left},${result.top},${result.right},${result.bottom}。`);
  }
  return result;
}

function sourceCoordinate(outputCoordinate, leading, trailing, sourceSize) {
  if (outputCoordinate < leading) return outputCoordinate;
  if (outputCoordinate === leading) return leading;
  return sourceSize - trailing + outputCoordinate - leading - 1;
}

function collapseNineSlicePixels(source, width, height, components, sliceBorder) {
  if (!source || !Number.isInteger(width) || !Number.isInteger(height)
      || width <= 0 || height <= 0 || !Number.isInteger(components) || components <= 0) {
    fail('PSD2UI_SLICE_PIXEL_INPUT_INVALID', '九宫像素处理缺少有效的图片尺寸或分量数。');
  }
  if (source.length !== width * height * components) {
    fail('PSD2UI_SLICE_PIXEL_LENGTH_INVALID', '九宫像素缓冲区长度与图片尺寸不一致。');
  }
  const border = normalizeSliceBorder(sliceBorder, width, height);
  const outputWidth = border.left + 1 + border.right;
  const outputHeight = border.top + 1 + border.bottom;
  const output = new source.constructor(outputWidth * outputHeight * components);

  for (let y = 0; y < outputHeight; y += 1) {
    const sourceY = sourceCoordinate(y, border.top, border.bottom, height);
    for (let x = 0; x < outputWidth; x += 1) {
      const sourceX = sourceCoordinate(x, border.left, border.right, width);
      const sourceOffset = (sourceY * width + sourceX) * components;
      const outputOffset = (y * outputWidth + x) * components;
      for (let component = 0; component < components; component += 1) {
        output[outputOffset + component] = source[sourceOffset + component];
      }
    }
  }
  return { pixels: output, width: outputWidth, height: outputHeight, border };
}

module.exports = { normalizeSliceBorder, collapseNineSlicePixels };
