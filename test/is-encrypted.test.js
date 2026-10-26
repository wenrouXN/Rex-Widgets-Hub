// isEncrypted 必须认出 REXENC v2 的文本魔数（加密模块的元数据全在密文里，
// 认不出来就会被当明文解析 → widget_id 落成 UUID、标题落成文件名）
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/../index.js', 'utf8');
const m = src.match(/function isEncrypted\(buf\)\s*\{[\s\S]*?\n\}/);
if (!m) { console.error('未找到 isEncrypted'); process.exit(1); }
// eslint-disable-next-line no-new-func
const isEncrypted = new Function(m[0] + '; return isEncrypted;')();

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch (e) { console.log('  ❌ ' + name + '  ' + e.message); failed++; }
}

const enc = (s) => new TextEncoder().encode(s);

console.log('\nisEncrypted 测试\n');

check('REXENC v2 文本头 → 1', () => {
  const buf = enc('REXENC\n{"v":2,"mkv":"rex-1","alg":"A256GCM"}\nabcdef');
  assert.strictEqual(isEncrypted(buf), 1);
});

check('REXENC 后跟 \\r\\n → 1', () => {
  assert.strictEqual(isEncrypted(enc('REXENC\r\n{}')), 1);
});

check('旧版 0xAE 二进制魔数 → 1（不能回归）', () => {
  assert.strictEqual(isEncrypted(new Uint8Array([0x00, 0xAE, 0x01, 0x02])), 1);
});

check('旧版 0xFE 二进制魔数 → 1（不能回归）', () => {
  assert.strictEqual(isEncrypted(new Uint8Array([0xFE, 0x00, 0x00])), 1);
});

check('普通 JS 明文 → 0', () => {
  const buf = enc('function WidgetMetadata(env){ return { id: "jable_int", title: "Jable" } }');
  assert.strictEqual(isEncrypted(buf), 0);
});

check('REXENC 出现在文件中间（非开头）→ 0', () => {
  const buf = enc('// prefix comment\nREXENC\n{}');
  assert.strictEqual(isEncrypted(buf), 0);
});

check('短于 6 字节不崩 → 0', () => {
  assert.strictEqual(isEncrypted(new Uint8Array([0x41, 0x42])), 0);
  assert.strictEqual(isEncrypted(new Uint8Array([])), 0);
});

check('近似但不等于 REXENC（REXEN）→ 0', () => {
  assert.strictEqual(isEncrypted(enc('REXEN\n{}')), 0);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
