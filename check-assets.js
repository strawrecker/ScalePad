/* 素材完整性校验：确保题库引用的图片都在磁盘上，也都被 Service Worker 预缓存。
 * 第 3 项最要紧 —— sw.js 的 install 用的是 cache.addAll，只要清单里有一个
 * 文件取不到，整个 install 就会失败，离线功能全废。
 *
 * 用法：node check-assets.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const strip = (p) => p.replace(/^\.\//, '');

/* presets.js 和 sw.js 都不是模块，直接在沙箱里跑一遍取它们的顶层变量。 */
const runInSandbox = (file, sandbox) => {
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox);
  return sandbox;
};

const presets = runInSandbox('presets.js', { window: {}, console }).window.scalePadPresets;

const used = new Set();
const collect = (value) => {
  if (typeof value === 'string') {
    if (value.endsWith('.png')) used.add(strip(value));
    return;
  }
  if (Array.isArray(value)) return value.forEach(collect);
  if (value && typeof value === 'object') return Object.values(value).forEach(collect);
};
collect(presets);

/* sw.js 顶层是 const，vm 取不到，换成 var 再跑。 */
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8').replace(/^const /gm, 'var ');
const swSandbox = {
  self: { addEventListener() {}, location: { origin: 'https://local' }, skipWaiting() {}, clients: { claim() {} } },
  caches: { open: () => Promise.resolve(), keys: () => Promise.resolve([]) },
  URL,
  console
};
vm.createContext(swSandbox);
vm.runInContext(swSource, swSandbox);
const precached = new Set([...swSandbox.CORE_FILES, ...swSandbox.MATERIAL_FILES].map(strip));

const exists = (p) => fs.existsSync(path.join(root, p));
const missingOnDisk = [...used].filter((p) => !exists(p));
const notPrecached = [...used].filter((p) => !precached.has(p));
const precachedMissing = [...precached].filter((p) => p !== '' && p !== '/' && !exists(p));

const report = (label, list) => {
  if (!list.length) return console.log(`  通过  ${label}`);
  console.log(`  失败  ${label}（${list.length} 项）`);
  list.forEach((p) => console.log(`        ${p}`));
};

console.log(`题库引用图片 ${used.size} 张，Service Worker 预缓存 ${precached.size} 条\n`);
report('题库引用的图片都在磁盘上', missingOnDisk);
report('题库引用的图片都已预缓存', notPrecached);
report('预缓存清单没有指向缺失文件', precachedMissing);

const failed = missingOnDisk.length + notPrecached.length + precachedMissing.length;
if (failed) {
  console.log('\n有问题需要修复。');
  process.exit(1);
}
console.log('\n全部通过。');
