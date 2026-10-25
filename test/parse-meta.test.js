#!/usr/bin/env node
/**
 * parseMeta 单元测试 —— 覆盖 2026-10-25 修的 5 个缺陷。
 *
 * 跑法：node test/parse-meta.test.js
 * 退出码 0 = 全过，非 0 = 有用例失败。
 *
 * 为什么要有这个文件：parseMeta 是 Hub 的核心逻辑（决定 .rex 里每个
 * widget 的 id/version/requiredVersion），一旦回归，Rex 端表现为
 * 「模块信息校验失败」，而 Hub 侧完全静默 —— 靠人眼看不出。
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 从 index.js 抽出 parseMeta 相关函数（Worker 是 ES module，不能直接 require）
const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const start = src.indexOf('function parseMeta(fn, bytes)');
const end = src.indexOf('function isEncrypted(');
if (start < 0 || end < 0) {
  console.error('❌ 无法从 index.js 抽取 parseMeta（函数签名变了？）');
  process.exit(1);
}
const { parseMeta } = new Function(
  src.slice(start, end) + '\nreturn { parseMeta };'
)();

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    fail++;
  }
}
const meta = (code) => parseMeta('test.js', new TextEncoder().encode(code));

console.log('\nparseMeta 单元测试\n');

// ── 1. 元数据在文件前部（常规模块，走快路径）
test('前部 WidgetMetadata 能解析', () => {
  const r = meta(`WidgetMetadata = {
  id: "rexmedia",
  title: "XN Media Bridge",
  version: "1.0.0",
  requiredVersion: "0.0.1",
  modules: []
};`);
  assert.strictEqual(r.id, 'rexmedia');
  assert.strictEqual(r.title, 'XN Media Bridge');
  assert.strictEqual(r.version, '1.0.0');
  assert.strictEqual(r.requiredVersion, '0.0.1');
});

// ── 2. 【核心】元数据在 2KB 之后（danmu_auto.js 场景，走慢路径）
test('元数据在 1301128 字节处仍能解析（慢路径）', () => {
  const padding = '// ' + 'x'.repeat(1300000) + '\n';
  const r = meta(padding + `WidgetMetadata = {
  id: "forward.auto.danmu2",
  title: "自动链接弹幕v2",
  version: "1.21.7",
  requiredVersion: "0.0.2"
};`);
  assert.strictEqual(r.id, 'forward.auto.danmu2', 'id 必须解析出来，不能退 UUID');
  assert.strictEqual(r.version, '1.21.7');
  assert.strictEqual(r.requiredVersion, '0.0.2');
});

// ── 3. 元数据恰好在 2KB 边界附近
test('元数据跨 2KB 边界能解析', () => {
  const padding = '// ' + 'y'.repeat(2040) + '\n';
  const r = meta(padding + `WidgetMetadata = { id: "edge.case", version: "2.0.0" };`);
  assert.strictEqual(r.id, 'edge.case');
});

// ── 4. \uXXXX 转义解码
test('title 的 \\uXXXX 转义会解码成中文', () => {
  const r = meta(`WidgetMetadata = {
  id: "x",
  title: "\\u81EA\\u52A8\\u94FE\\u63A5\\u5F39\\u5E55v2",
  version: "1.0.0"
};`);
  assert.strictEqual(r.title, '自动链接弹幕v2');
  assert.ok(!r.title.includes('\\u'), 'title 不应残留反斜杠转义');
});

// ── 5. 变量引用 version: wv
test('version: wv 变量引用能追溯到声明值', () => {
  const r = meta(`var wv = "1.21.7";
WidgetMetadata = {
  id: "forward.auto.danmu2",
  title: "自动链接弹幕v2",
  version: wv
};`);
  assert.strictEqual(r.version, '1.21.7');
});

// ── 6. requiredVersion 不被丢弃（上游曾硬编码 0.0.1）
test('requiredVersion 能解析（不被硬编码覆盖）', () => {
  const r = meta(`WidgetMetadata = {
  id: "x",
  requiredVersion: "0.0.2",
  version: "1.0.0"
};`);
  assert.strictEqual(r.requiredVersion, '0.0.2');
});

// ── 7. 无 WidgetMetadata 时返回空对象（不抛异常）
test('无 WidgetMetadata 返回空对象', () => {
  const r = meta('// nothing here\nconsole.log(1);');
  assert.deepStrictEqual(r, {});
});

// ── 8. 小文件（<2KB）走快路径也能解析
test('小于 2KB 的文件正常解析', () => {
  const r = meta('WidgetMetadata = { id: "tiny", version: "0.1.0" };');
  assert.strictEqual(r.id, 'tiny');
  assert.strictEqual(r.version, '0.1.0');
});

// ── 9. 解密/加密模块标记不应影响解析
test('注释块形式的 WidgetMetadata 能解析', () => {
  const r = meta(`/* @type widget
WidgetMetadata = { id: "commented", version: "3.0.0" };
*/`);
  assert.strictEqual(r.id, 'commented');
});

// ── 10. 版本比较（降级护栏依赖）
test('cmpVersion 正确比较版本', () => {
  const src2 = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const s2 = src2.indexOf('function cmpVersion');
  const e2 = src2.indexOf('function parseMeta(fn, bytes)');
  const { cmpVersion } = new Function(
    src2.slice(s2, e2) + '\nreturn { cmpVersion };'
  )();
  assert.strictEqual(cmpVersion('1.21.7', '1.21.6'), 1, '新版 > 旧版');
  assert.strictEqual(cmpVersion('1.21.6', '1.21.7'), -1, '旧版 < 新版（降级要拦住）');
  assert.strictEqual(cmpVersion('1.0.0', '1.0.0'), 0);
  assert.strictEqual(cmpVersion('1.10.0', '1.9.0'), 1, '数值比较不是字符串比较');
  assert.strictEqual(cmpVersion('', '1.0.0'), null, '空版本无法比较');
  assert.strictEqual(cmpVersion('v2.0', '1.9'), 1, 'v 前缀要忽略');
});

// ── 11. 【核心】JSON 风格带引号的键（jable_int v2.0.0 场景）
test('带引号的键 "id": "xxx" 能解析', () => {
  const r = meta(`WidgetMetadata = {
  "id": "jable_int",
  "title": "Jable",
  "description": "修复声音&恢复大量分类",
  "author": "nibiru｜MakkaPakka｜蝴蝶",
  "version": "2.0.0",
  "requiredVersion": "0.0.2",
  "modules": []
};`);
  assert.strictEqual(r.id, 'jable_int', '带引号的 id 不能解析成空');
  assert.strictEqual(r.title, 'Jable');
  assert.strictEqual(r.version, '2.0.0');
  assert.strictEqual(r.requiredVersion, '0.0.2');
  assert.strictEqual(r.author, 'nibiru｜MakkaPakka｜蝴蝶');
});

// ── 12. 字符串值里带转义引号不截断
test('字符串值含 \\" 时能完整解析', () => {
  const r = meta(`WidgetMetadata = {
  id: "esc.test",
  title: "A \\"quoted\\" title",
  version: "1.0.0"
};`);
  assert.strictEqual(r.id, 'esc.test');
  assert.strictEqual(r.title, 'A "quoted" title');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
