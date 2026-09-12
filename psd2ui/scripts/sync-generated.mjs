import { access, copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const toolRoot = path.resolve(scriptDirectory, '..');
const checkOnly = process.argv.includes('--check');

const projections = [
  {
    source: path.join(toolRoot, 'Core'),
    target: path.join(toolRoot, 'Plus-ins', 'PSD2UI', 'generated', 'core'),
    extension: '.js'
  }
];

async function listFiles(root, extension, relativeDirectory = '') {
  const current = path.join(root, relativeDirectory);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, extension, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

async function filesEqual(leftPath, rightPath) {
  try {
    await access(rightPath);
  } catch {
    return false;
  }
  const [left, right] = await Promise.all([readFile(leftPath), readFile(rightPath)]);
  return left.equals(right);
}

let drift = false;
for (const projection of projections) {
  const sourceFiles = await listFiles(projection.source, projection.extension);
  for (const relativePath of sourceFiles) {
    const sourcePath = path.join(projection.source, relativePath);
    const targetPath = path.join(projection.target, relativePath);
    if (checkOnly) {
      if (!await filesEqual(sourcePath, targetPath)) {
        drift = true;
        process.stderr.write(`生成投影不一致：${path.relative(toolRoot, targetPath)}\n`);
      }
      continue;
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
  }
}

if (drift) {
  process.exitCode = 1;
} else {
  process.stdout.write(checkOnly ? '生成投影一致。\n' : '生成投影已同步。\n');
}
