'use strict';
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const acorn = require('acorn');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'Plus-ins/PSD2UI');
const cep = path.join(root, 'Plus-ins/PSD2UI-CEP');

function verifyExtendScript(code) {
  const ast = acorn.parse(code.replace(/^#.*$/gm, ''), { ecmaVersion: 3, preserveParens: true, locations: true });
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    // Photoshop's legacy parser associates an unparenthesized chained ternary
    // differently from ECMA-262. This was reproduced in the actual JSX engine.
    if (node.type === 'ConditionalExpression' && ['test', 'consequent', 'alternate'].some(key => node[key].type === 'ConditionalExpression')) {
      throw new Error(`ExtendScript 第 ${node.loc.start.line} 行的嵌套条件表达式必须显式加括号。`);
    }
    if (node.regex) {
      let escaped = false, inClass = false;
      for (const character of node.regex.pattern) {
        if (escaped) { escaped = false; continue; }
        if (character === '\\') { escaped = true; continue; }
        if (character === '[') inClass = true;
        if (character === ']') inClass = false;
        if (inClass && character === '/') throw new Error(`ExtendScript 第 ${node.loc.start.line} 行的正则字符类必须转义 /。`);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'regex') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  }
  visit(ast);
}

async function build(checkOnly) {
  const output = await esbuild.build({
    absWorkingDir: root, entryPoints: [path.join(cep, 'src/entry.js')],
    bundle: true, write: false, platform: 'node', format: 'iife',
    target: ['es2017', 'chrome61', 'node8.6'], charset: 'utf8', legalComments: 'inline',
    plugins: [{ name: 'photoshop-host', setup(api) {
      api.onResolve({ filter: /^photoshop$/ }, () => ({ path: path.join(cep, 'src/photoshop.js') }));
      api.onResolve({ filter: /^uxp$/ }, () => ({ path: path.join(cep, 'src/uxp.js') }));
      api.onResolve({ filter: /(^|\/)xmpStore$/ }, args => args.importer.startsWith(source)
        ? { path: path.join(cep, 'src/xmpStore.js') } : undefined);
    } }]
  });
  const javascript = output.outputFiles[0].contents;
  const bundleText = Buffer.from(javascript).toString('utf8');
  try { acorn.parse(bundleText, { ecmaVersion: 2017, allowReturnOutsideFunction: false }); }
  catch (error) {
    if (error.loc) error.message += '\n' + bundleText.split('\n').slice(error.loc.line - 2, error.loc.line + 1).join('\n');
    throw error;
  }
  const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8')
    .replace('<script src="uiShell.js"></script><script src="app.js"></script>', '<script src="panel.js"></script>');
  const pngLicense = 'pngjs 4.0.1\nhttps://github.com/pngjs/pngjs\n\n'
    + fs.readFileSync(path.join(root, 'node_modules/pngjs/LICENSE'), 'utf8');
  const files = [['panel.js', javascript], ['index.html', Buffer.from(html)],
    ['style.css', fs.readFileSync(path.join(source, 'style.css'))], ['THIRD-PARTY-LICENSES.txt', Buffer.from(pngLicense)]];
  for (const [name, content] of files) {
    const target = path.join(cep, name);
    if (checkOnly) {
      if (!fs.existsSync(target) || !fs.readFileSync(target).equals(Buffer.from(content))) throw new Error(`CEP 生成文件不一致：${target}；运行 npm run build:cep。`);
    } else fs.writeFileSync(target, content);
  }
  // The JSX boundary must never accidentally acquire CEF/Node syntax.
  for (const name of fs.readdirSync(path.join(cep, 'host'))) {
    if (!/\.(jsx|js)$/.test(name)) continue;
    verifyExtendScript(fs.readFileSync(path.join(cep, 'host', name), 'utf8'));
  }
  verifyExtendScript(fs.readFileSync(path.join(root, 'scripts/cep-smoke.jsx'), 'utf8'));
  console.log(checkOnly ? 'CEP bundle 和 ES3 宿主一致。' : 'CEP 9 面板已生成；ES2017 / ES3 语法检查通过。');
}
if (require.main === module) build(process.argv.includes('--check')).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { build, verifyExtendScript };
