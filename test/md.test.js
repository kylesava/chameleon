const test = require('node:test');
const assert = require('node:assert');
const { md } = require('../public/richtext.js');

test('fenced code blocks render as pre, not mangled inline code', () => {
  const out = md('Example:\n```json\n{"tool": "search_flights",\n "args": {"origin": "LIS"}}\n```\nDone.');
  assert.match(out, /<pre class="code" data-lang="json">/);
  assert.ok(out.includes('&quot;tool&quot;: &quot;search_flights&quot;,'));
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
  assert.match(out, /<h4[^>]*>Title<\/h4>/);
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

/* ---- richer blocks ---- */

test('tables render with headers, rows and alignment', () => {
  const out = md('| Layer | Job |\n|:--|--:|\n| L1 | routes |\n| L2 | switches |');
  assert.match(out, /<div class="tablewrap"><table>/);
  assert.match(out, /<th[^>]*>Layer<\/th>/);
  assert.match(out, /<td[^>]*>switches<\/td>/);
  assert.match(out, /text-align:right/);
  assert.equal((out.match(/<tr>/g) || []).length, 3);
});

test('a table with inline formatting in cells', () => {
  const out = md('| a | b |\n|---|---|\n| **bold** | `code` |');
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<code>code<\/code>/);
});

test('callouts become styled blocks with their own icon and title', () => {
  const out = md('> [!KEY] The one idea\n> Electrons never touch ATP.');
  assert.match(out, /<div class="callout key">/);
  assert.match(out, /The one idea/);
  assert.match(out, /Electrons never touch ATP\./);
});

test('a callout with no title falls back to a sensible label', () => {
  const out = md('> [!WARNING]\n> Mind the gap.');
  assert.match(out, /callout warn/);
  assert.match(out, /Watch out/);
});

test('a plain blockquote stays a blockquote', () => {
  const out = md('> just a quote');
  assert.match(out, /<blockquote><p>just a quote<\/p><\/blockquote>/);
});

test('mermaid and chart fences become mountable viz nodes, not code', () => {
  const m = md('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(m, /class="viz mermaid-src"/);
  assert.match(m, /data-src="graph TD; A--&gt;B;"/);
  const c = md('```chart\n{"mark":"bar"}\n```');
  assert.match(c, /class="viz chart-src"/);
});

test('task lists render as checkable items', () => {
  const out = md('- [x] done thing\n- [ ] open thing');
  assert.match(out, /<li class="task done">/);
  assert.match(out, /<li class="task ">/);
});

test('links are rendered but javascript: urls are not', () => {
  const ok = md('see [the docs](https://example.com/x)');
  assert.match(ok, /<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener">the docs<\/a>/);
  const bad = md('see [bad](javascript:alert(1))');
  assert.ok(!bad.includes('<a href'), 'unsafe scheme must not become a link');
  assert.match(bad, /see bad/);
});

test('images allowed only from http(s)', () => {
  assert.match(md('![alt](https://x/y.png)'), /<img alt="alt" src="https:\/\/x\/y\.png"/);
  assert.ok(!md('![alt](data:text/html;base64,xxx)').includes('<img'));
});

test('horizontal rules and strikethrough', () => {
  assert.match(md('---'), /<hr>/);
  assert.match(md('~~gone~~'), /<del>gone<\/del>/);
});

test('paragraph lines are joined, blocks are not swallowed', () => {
  const out = md('line one\nline two\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(out, /<p>line one line two<\/p>/);
  assert.match(out, /<table>/);
});
