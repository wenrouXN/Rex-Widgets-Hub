#!/usr/bin/env node
/**
 * rexSafeText 单元测试 —— 2026-10-26 新增。
 *
 * 背景：Rex 客户端会校验**源 JSON 的文本字段**（合集/模块的 title、description、
 * author），出现独立单词 Rex（大小写不敏感、前后不能紧邻字母）就整源拒绝，
 * 报「模块信息校验失败，请修改后重试」。这条规则未文档化，报错也不定位字段。
 * 实测：Rex / rex / REX / "Rex-" / "rex.860423.xyz" 命中；Rexx / RexNow 通过；
 *      模块 .js 内部的 WidgetMetadata 文案不校验。
 *
 * 跑法：node test/rex-safe-text.test.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const s = src.indexOf('function rexSafeText');
const e = src.indexOf('function isEncrypted(');
if (s < 0 || e < 0) {
  console.error('❌ 无法从 index.js 抽取 rexSafeText');
  process.exit(1);
}
const { rexSafeText } = new Function(src.slice(s, e) + '\nreturn { rexSafeText };')();

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

console.log('\nrexSafeText 单元测试\n');

test('独立单词 Rex（三种大小写）都要替换', () => {
  assert.strictEqual(rexSafeText('Rex'), 'RexNow');
  assert.strictEqual(rexSafeText('rex'), 'RexNow');
  assert.strictEqual(rexSafeText('REX'), 'RexNow');
});

test('"Rex-" 和 "rex.域名" 命中（实测会被拒）', () => {
  assert.strictEqual(rexSafeText('Rex-'), 'RexNow-');
  assert.strictEqual(rexSafeText('rex.860423.xyz'), 'RexNow.860423.xyz');
});

test('Rexx / RexNow 不能被改（实测可以通过）', () => {
  assert.strictEqual(rexSafeText('Rexx'), 'Rexx');
  assert.strictEqual(rexSafeText('RexNow'), 'RexNow');
  assert.strictEqual(rexSafeText('RexNow 客户端专用'), 'RexNow 客户端专用');
});

test('不含 Rex 的文案原样保留', () => {
  assert.strictEqual(rexSafeText('XN Media Bridge'), 'XN Media Bridge');
  assert.strictEqual(rexSafeText('自动链接弹幕v2'), '自动链接弹幕v2');
  assert.strictEqual(rexSafeText('𝙈𝙖𝙠𝙠𝙖𝙋𝙖𝙠𝙠𝙖'), '𝙈𝙖𝙠𝙠𝙖𝙋𝙖𝙠𝙠𝙖');
});

test('空值不抛异常', () => {
  assert.strictEqual(rexSafeText(''), '');
  assert.strictEqual(rexSafeText(null), '');
  assert.strictEqual(rexSafeText(undefined), '');
});

test('一句话里多处命中都替换', () => {
  assert.strictEqual(rexSafeText('Rex 官方 Rex 模块'), 'RexNow 官方 RexNow 模块');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
