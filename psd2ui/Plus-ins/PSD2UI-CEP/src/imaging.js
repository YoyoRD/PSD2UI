'use strict';

const PNG = require('pngjs').PNG;
const BufferType = require('./native').requireNative('buffer').Buffer;
const defaultStorage = require('./storage');
let temporaryCounter = 0;
const colorChunkTypes = ['iCCP', 'sRGB', 'gAMA', 'cHRM'];

function unsupported(message) { throw new Error('[PSD2UI_CEP_IMAGING_UNSUPPORTED] ' + message); }
function dimensions(width, height, allowEmpty) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < (allowEmpty ? 0 : 1)
      || height < (allowEmpty ? 0 : 1) || !Number.isSafeInteger(width * height * 4)) {
    throw new Error('[PSD2UI_CEP_PIXEL_SIZE_INVALID] 无效的像素尺寸。');
  }
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    value ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function makeChunk(type, bytes) {
  const result = BufferType.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  result.write(type, 4, 4, 'ascii');
  bytes.copy(result, 8);
  result.writeUInt32BE(crc32(result.slice(4, bytes.length + 8)), bytes.length + 8);
  return result;
}

function colorChunks(buffer) {
  const result = [];
  for (let offset = 8; offset + 12 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    if (length > buffer.length - offset - 12) throw new Error('PNG chunk 长度无效。');
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (colorChunkTypes.indexOf(type) !== -1) result.push(BufferType.from(buffer.slice(offset, offset + length + 12)));
    offset += length + 12;
    if (type === 'IEND') break;
  }
  return result;
}

function withColorChunks(encoded, chunks) {
  if (!chunks || !chunks.length) return encoded;
  const parts = [encoded.slice(0, 8)];
  for (let offset = 8; offset + 12 <= encoded.length;) {
    const length = encoded.readUInt32BE(offset);
    const type = encoded.toString('ascii', offset + 4, offset + 8);
    if (colorChunkTypes.indexOf(type) === -1) parts.push(encoded.slice(offset, offset + length + 12));
    if (type === 'IHDR') chunks.forEach(function (chunk) { parts.push(chunk); });
    offset += length + 12;
  }
  return BufferType.concat(parts);
}

function imageDataFromPixels(pixels, options, chunks) {
  const width = options.width, height = options.height, components = options.components;
  dimensions(width, height, true);
  if ([3, 4].indexOf(components) === -1) unsupported('仅支持 RGB 或 RGBA。');
  if (options.colorSpace && options.colorSpace !== 'RGB') unsupported('仅支持 RGB 色彩空间。');
  if (options.chunky === false) unsupported('仅支持交错排列的 RGB(A) 像素。');
  if (!(pixels instanceof Uint8Array) && !(pixels instanceof Uint8ClampedArray)) unsupported('仅支持 8-bit 像素。');
  if (pixels.length !== width * height * components) throw new Error('像素缓冲区长度与图片尺寸不一致。');
  let data = new Uint8Array(pixels);
  const result = {
    width, height, components, componentSize: 8, colorSpace: 'RGB',
    colorProfile: String(options.colorProfile || ''), hasAlpha: components === 4,
    pixelFormat: components === 4 ? 'RGBA' : 'RGB', isChunky: true,
    type: 'image/uncompressed', _colorChunks: chunks || [],
    async getData(input) {
      if (!data) throw new Error('像素数据已释放。');
      if (input && input.chunky === false) unsupported('仅支持交错排列的 RGB(A) 像素。');
      return new Uint8Array(data);
    },
    dispose() { data = null; result._colorChunks = []; }
  };
  return result;
}

function requestedRectangle(bounds, width, height) {
  const source = bounds || {};
  const left = source.left == null ? 0 : Number(source.left);
  const top = source.top == null ? 0 : Number(source.top);
  const right = source.right != null ? Number(source.right) : source.width != null ? left + Number(source.width) : width;
  const bottom = source.bottom != null ? Number(source.bottom) : source.height != null ? top + Number(source.height) : height;
  if (![left, top, right, bottom].every(Number.isInteger) || right < left || bottom < top) {
    throw new Error('sourceBounds 必须是有效的整数像素范围。');
  }
  return { left: Math.max(0, Math.min(width, left)), top: Math.max(0, Math.min(height, top)),
    right: Math.max(0, Math.min(width, right)), bottom: Math.max(0, Math.min(height, bottom)) };
}

function extractPixels(png, bounds, applyAlpha) {
  const requested = requestedRectangle(bounds, png.width, png.height);
  let left = requested.right, top = requested.bottom, right = requested.left, bottom = requested.top;
  // Imaging trims only the requested region containing real alpha-bearing data.
  for (let y = requested.top; y < requested.bottom; y += 1) {
    for (let x = requested.left; x < requested.right; x += 1) {
      if (!png.data[(y * png.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  if (right <= left || bottom <= top) { left = requested.left; top = requested.top; right = left; bottom = top; }
  const width = right - left, height = bottom - top;
  const components = applyAlpha === true || png.alpha === false ? 3 : 4;
  const pixels = new Uint8Array(width * height * components);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = ((y + top) * png.width + x + left) * 4;
      const to = (y * width + x) * components;
      const alpha = png.data[from + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[to + channel] = applyAlpha === true
          ? Math.round((png.data[from + channel] * alpha + 255 * (255 - alpha)) / 255)
          : png.data[from + channel];
      }
      if (components === 4) pixels[to + 3] = alpha;
    }
  }
  return { pixels, width, height, components, sourceBounds: { left, top, right, bottom } };
}

function createImaging(dependencies) {
  const config = dependencies || {};
  const storage = config.storage || defaultStorage;
  const invoke = config.invoke || function (method, params) { return require('./photoshop').invoke(method, params); };
  const knownProfiles = new Map();

  async function temporaryFile() {
    const folder = await storage.localFileSystem.getTemporaryFolder();
    temporaryCounter += 1;
    return folder.createFile('pixels-' + Date.now() + '-' + temporaryCounter + '.png', { overwrite: false });
  }

  async function getPixels(input) {
    const options = input || {};
    if (options.componentSize != null && options.componentSize !== 8) unsupported('当前图片导出只支持 8-bit 像素。');
    if (options.colorSpace && options.colorSpace !== 'RGB') unsupported('当前图片导出只支持 RGB。');
    if (options.layerID != null || options.historyStateID != null) unsupported('当前图片导出只读取工作台文档合成图。');
    const file = await temporaryFile();
    try {
      const result = await invoke('exportPixels', {
        documentID: options.documentID, path: file.nativePath,
        colorProfile: options.colorProfile || undefined
      });
      if (!result || result.colorSpace !== 'RGB') throw new Error('Photoshop 未返回有效 RGB 像素导出。');
      if (result.path && result.path !== file.nativePath) throw new Error('Photoshop 像素导出路径不符。');
      if (options.colorProfile && result.colorProfile !== options.colorProfile) {
        throw new Error('Photoshop 像素导出的色彩配置不符：' + (result.colorProfile || '<none>'));
      }
      const bytes = BufferType.from(await file.read({ format: storage.formats.binary }));
      const png = PNG.sync.read(bytes);
      if (png.depth !== 8) unsupported('Photoshop 导出的临时 PNG 不是 8-bit。');
      if (png.width !== result.width || png.height !== result.height) throw new Error('Photoshop 像素导出的画布尺寸不符。');
      const chunks = colorChunks(bytes);
      const profile = String(result.colorProfile || '');
      if (profile && chunks.length) knownProfiles.set(profile, chunks);
      const extracted = extractPixels(png, options.sourceBounds, options.applyAlpha);
      const imageData = imageDataFromPixels(extracted.pixels, {
        width: extracted.width, height: extracted.height, components: extracted.components,
        colorSpace: 'RGB', colorProfile: profile
      }, chunks);
      return { imageData, sourceBounds: extracted.sourceBounds, level: 0 };
    } finally { await file.delete(); }
  }

  async function createImageDataFromBuffer(buffer, options) {
    const input = options || {};
    if (input.componentSize != null && input.componentSize !== 8) unsupported('只支持 8-bit 像素。');
    let chunks = knownProfiles.get(String(input.colorProfile || '')) || [];
    // sRGB is a standardized PNG color space; other profiles are never invented.
    if (!chunks.length && input.colorProfile === 'sRGB IEC61966-2.1') chunks = [makeChunk('sRGB', BufferType.from([0]))];
    return imageDataFromPixels(buffer, input, chunks);
  }

  async function putPixels(input) {
    const options = input || {};
    const data = options.imageData;
    if (!data || typeof data.getData !== 'function' || data.componentSize !== 8 || data.colorSpace !== 'RGB') {
      unsupported('putPixels 要求 8-bit RGB(A) ImageData。');
    }
    dimensions(data.width, data.height, false);
    if (options.replace === false) unsupported('当前图片导出只支持替换临时图层的全部像素。');
    const target = options.targetBounds || {};
    if (Number(target.left || 0) !== 0 || Number(target.top || 0) !== 0
        || target.width != null && target.width !== data.width || target.height != null && target.height !== data.height
        || target.right != null && target.right !== data.width || target.bottom != null && target.bottom !== data.height) {
      unsupported('当前图片导出只写入匹配临时画布的完整像素。');
    }
    const pixels = await data.getData({ chunky: true });
    if ([3, 4].indexOf(data.components) === -1 || pixels.length !== data.width * data.height * data.components) {
      throw new Error('ImageData 像素缓冲区无效。');
    }
    const rgba = BufferType.alloc(data.width * data.height * 4);
    for (let pixel = 0; pixel < data.width * data.height; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) rgba[pixel * 4 + channel] = pixels[pixel * data.components + channel];
      rgba[pixel * 4 + 3] = data.components === 4 ? pixels[pixel * 4 + 3] : 255;
    }
    const encoded = withColorChunks(PNG.sync.write({ width: data.width, height: data.height, data: rgba },
      { bitDepth: 8, colorType: 6, inputColorType: 6, inputHasAlpha: true }), data._colorChunks);
    const file = await temporaryFile();
    try {
      await file.write(encoded, { format: storage.formats.binary });
      return await invoke('importPixels', {
        documentID: options.documentID, layerID: options.layerID, path: file.nativePath,
        colorProfile: data.colorProfile, colorSpace: 'RGB', replace: true,
        targetBounds: { left: 0, top: 0, width: data.width, height: data.height }
      });
    } finally { await file.delete(); }
  }

  return { getPixels, createImageDataFromBuffer, putPixels };
}

module.exports = createImaging();
module.exports.createImaging = createImaging;
