'use strict';

const requireNative = require('./native').requireNative;
const fs = requireNative('fs');
const path = requireNative('path');
const os = requireNative('os');
const formats = { utf8: 'utf8', binary: 'binary' };

function callFs(method, args) {
  return new Promise(function (resolve, reject) {
    fs[method].apply(fs, args.concat(function (error, value) {
      if (error) reject(error); else resolve(value);
    }));
  });
}

function nativePathFromUrl(value) {
  let result = String(value || '');
  if (/^file:/i.test(result)) {
    result = result.slice(5);
    if (/^\/\/\//.test(result)) result = result.slice(2);
    if (/^\/[a-z]:[\\/]/i.test(result)) result = result.slice(1);
    try { result = decodeURI(result); } catch (_) { /* Literal percent in a native path. */ }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(result) && !/^[a-z]:[\\/]/i.test(result)) {
    throw new Error('[PSD2UI_FILE_URL_INVALID] 只支持本地文件路径。');
  }
  if (!result || result.indexOf('\0') !== -1 || !path.isAbsolute(result)) {
    throw new Error('[PSD2UI_FILE_PATH_INVALID] 文件路径必须是绝对路径。');
  }
  return path.resolve(result);
}

function assertChildName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..'
      || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('[PSD2UI_ENTRY_NAME_INVALID] 文件或目录名不能包含路径、保留名或特殊字符。');
  }
  return name;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..'
    && relative.indexOf('..' + path.sep) !== 0);
}

async function statIfPresent(target) {
  try { return await callFs('lstat', [target]); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function checkPath(target, root, mayBeMissing) {
  if (!isWithin(root, target)) throw new Error('[PSD2UI_PATH_ESCAPE] 文件路径超出已选择目录。');
  const stat = await statIfPresent(target);
  if (!stat && !mayBeMissing) {
    const missing = new Error('文件或目录不存在：' + target); missing.code = 'ENOENT'; throw missing;
  }
  if (stat && stat.isSymbolicLink()) throw new Error('[PSD2UI_PATH_LINK] 不允许通过符号链接读写资源。');
  const real = await callFs('realpath', [stat ? target : path.dirname(target)]);
  if (!isWithin(root, real)) throw new Error('[PSD2UI_PATH_ESCAPE] 文件实际路径超出已选择目录。');
  return stat;
}

class Entry {
  constructor(nativePath, root, isFolder, protectedRoot) {
    this.nativePath = nativePath;
    this.name = path.basename(nativePath);
    this.isFolder = Boolean(isFolder);
    this.isFile = !this.isFolder;
    this._root = root;
    this._protectedRoot = Boolean(protectedRoot);
  }

  async _check() {
    const stat = await checkPath(this.nativePath, this._root, false);
    if (this.isFolder !== stat.isDirectory() || this.isFile !== stat.isFile()) {
      throw new Error('[PSD2UI_ENTRY_CHANGED] 文件类型已改变：' + this.nativePath);
    }
  }

  async getEntries() {
    if (!this.isFolder) throw new Error('只有目录可以列出内容。');
    await this._check();
    const names = await callFs('readdir', [this.nativePath]);
    const result = [];
    for (const name of names) {
      const child = path.join(this.nativePath, name);
      const stat = await checkPath(child, this._root, false);
      if (stat.isDirectory() || stat.isFile()) result.push(new Entry(child, this._root, stat.isDirectory(), false));
    }
    return result;
  }

  async createFolder(name) {
    if (!this.isFolder) throw new Error('只有目录可以创建子目录。');
    await this._check();
    const child = path.join(this.nativePath, assertChildName(name));
    await checkPath(child, this._root, true);
    await callFs('mkdir', [child]);
    return new Entry(child, this._root, true, false);
  }

  async createFile(name, options) {
    if (!this.isFolder) throw new Error('只有目录可以创建文件。');
    await this._check();
    const child = path.join(this.nativePath, assertChildName(name));
    const stat = await checkPath(child, this._root, true);
    if (stat && !stat.isFile()) throw new Error('[PSD2UI_OUTPUT_PATH_CONFLICT] 目标不是文件：' + child);
    const descriptor = await callFs('open', [child, options && options.overwrite === true ? 'w' : 'wx']);
    await callFs('close', [descriptor]);
    return new Entry(child, this._root, false, false);
  }

  async read(options) {
    if (!this.isFile) throw new Error('只有文件可以读取。');
    await this._check();
    const binary = options && options.format === formats.binary;
    const data = await callFs('readFile', binary ? [this.nativePath] : [this.nativePath, 'utf8']);
    return binary ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  }

  async write(value, options) {
    if (!this.isFile) throw new Error('只有文件可以写入。');
    await this._check();
    const binary = options && options.format === formats.binary;
    const BufferType = requireNative('buffer').Buffer;
    const data = binary ? BufferType.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value) : String(value);
    await callFs('writeFile', [this.nativePath, data, binary ? {} : { encoding: 'utf8' }]);
  }

  async copyTo(destination, options) {
    if (!this.isFile || !destination || !destination.isFolder || typeof destination._check !== 'function') {
      throw new Error('copyTo 要求源文件和目标目录。');
    }
    await this._check();
    await destination._check();
    const target = path.join(destination.nativePath, assertChildName(this.name));
    const stat = await checkPath(target, destination._root, true);
    if (stat && !stat.isFile()) throw new Error('[PSD2UI_OUTPUT_PATH_CONFLICT] 目标不是文件：' + target);
    if (path.resolve(target) === path.resolve(this.nativePath)) throw new Error('不能把文件复制到自身。');
    await callFs('copyFile', [this.nativePath, target,
      options && options.overwrite === true ? 0 : fs.constants.COPYFILE_EXCL]);
    return new Entry(target, destination._root, false, false);
  }

  async delete() {
    await this._check();
    if (this._protectedRoot) throw new Error('[PSD2UI_DELETE_ROOT] 不能删除已选择的输出根目录。');
    if (this.isFolder) {
      const children = await this.getEntries();
      for (const child of children) await child.delete();
      await this._check();
      await callFs('rmdir', [this.nativePath]);
    } else {
      await callFs('unlink', [this.nativePath]);
    }
  }
}

async function getEntryWithUrl(value) {
  const requested = nativePathFromUrl(value);
  const stat = await callFs('lstat', [requested]);
  if (stat.isSymbolicLink()) throw new Error('[PSD2UI_PATH_LINK] 不允许将符号链接作为资源入口。');
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('资源入口必须是文件或目录。');
  const real = await callFs('realpath', [requested]);
  return new Entry(real, stat.isDirectory() ? real : path.dirname(real), stat.isDirectory(), stat.isDirectory());
}

function createStorage(options) {
  const config = options || {};
  let temporaryFolderPromise = null;
  const localFileSystem = {
    getEntryWithUrl,
    async getFolder() {
      const cepApi = typeof window !== 'undefined' && window.cep || typeof cep !== 'undefined' && cep;
      const picker = config.pickFolder || function () {
        if (!cepApi || !cepApi.fs) throw new Error('[PSD2UI_FOLDER_PICKER_UNAVAILABLE] CEP 未提供目录选择器。');
        const choose = cepApi.fs.showOpenDialogEx || cepApi.fs.showOpenDialog;
        if (typeof choose !== 'function') throw new Error('CEP 未提供目录选择器。');
        const result = choose.call(cepApi.fs, false, true, '选择 PSD2UI 输出目录', '', '');
        if (result.err) throw new Error('选择输出目录失败，CEP 错误码：' + result.err);
        return result.data && result.data[0] || null;
      };
      const selected = await picker();
      if (!selected) return null;
      const entry = await getEntryWithUrl(selected);
      if (!entry.isFolder) throw new Error('请选择目录。');
      return entry;
    },
    async createPersistentToken(entry) {
      if (!entry || typeof entry._check !== 'function') throw new Error('无法记住无效的资源入口。');
      await entry._check();
      return 'psd2ui-cep-path-v1:' + encodeURIComponent(entry.nativePath);
    },
    async getEntryForPersistentToken(token) {
      const prefix = 'psd2ui-cep-path-v1:';
      if (typeof token !== 'string' || token.indexOf(prefix) !== 0) throw new Error('CEP 输出目录记录无效，请重新选择。');
      return getEntryWithUrl(decodeURIComponent(token.slice(prefix.length)));
    },
    getTemporaryFolder() {
      if (!temporaryFolderPromise) {
        temporaryFolderPromise = callFs('mkdtemp', [path.join(config.temporaryBase || os.tmpdir(), 'psd2ui-cep-')])
          .then(getEntryWithUrl).catch(function (error) { temporaryFolderPromise = null; throw error; });
      }
      return temporaryFolderPromise;
    }
  };
  return { formats, localFileSystem };
}

module.exports = createStorage();
module.exports.createStorage = createStorage;
module.exports.nativePathFromUrl = nativePathFromUrl;
