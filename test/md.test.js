const test = require('node:test');
const assert = require('node:assert');
const { md } = require('../public/apps.js');

test('fenced code blocks render as pre, not mangled inline code', () => {
  const out = md('Example:\n```json\n{"tool": "search_flights",\n "args": {"origin": "LIS"}}\n```\nDone.');
  assert.match(out, /<pre class="code" data-lang="json"><code>/);
  assert.ok(out.includes('{"tool": "search_flights",'));
  assert.match(out, /<p>Done\.<\/p>/);
  assert.ok(!out.includes('<code>json'), 'language tag must not leak into the body');
});

test('code contents are escaped and never inline-formatted', () => {
  const out = md('```js\nif (a < b && c) x = **not bold**;\n```');
  assert.ok(out.includes('a &lt; b &amp;&amp; c'));
  assert.ok(!out.includes('<strong>'), 'markdown inside a fence must stay literal');
});

test('fence without a language still renders', () => {
  const out = md('```\nplain text\n```');
  assert.match(out, /<pre class="code"><code>plain text<\/code><\/pre>/);
});

test('inline code, bold, italic, lists and headers still work', () => {
  const out = md('## Title\nUse `npm` and **bold** and *it*.\n- one\n- two\n\n1. first');
  assert.match(out, /<h4>Title<\/h4>/);
  assert.match(out, /<code>npm<\/code>/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>it<\/em>/);
  assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<ol><li>first<\/li><\/ol>/);
});

test('raw html in prose is escaped', () => {
  const out = md('Beware <script>alert(1)</script>');
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('multiple fences in one document keep their order', () => {
  const out = md('```\nA\n```\nmiddle\n```\nB\n```');
  assert.ok(out.indexOf('>A<') < out.indexOf('middle'));
  assert.ok(out.indexOf('middle') < out.indexOf('>B<'));
});
