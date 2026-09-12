'use strict';

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function assertUiResFolder(folder) {
  const actualPath = normalizePath(folder && folder.nativePath);
  if (!folder || !actualPath) {
    throw new Error('请选择一个有效且已授权的输出目录。');
  }
  if (folder.isFolder === false) {
    throw new Error(`输出目标必须是目录：${folder.nativePath || '<unknown>'}`);
  }
  return folder;
}

module.exports = {
  normalizePath,
  assertUiResFolder
};
