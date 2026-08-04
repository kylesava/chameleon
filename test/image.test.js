const test = require('node:test');
const assert = require('node:assert');
const { md } = require('../public/richtext.js');
const images = require('../server/images.js');
const { TOOLS } = require('../server/tools.js');

test('gen: images become a placeholder carrying the prompt, not a broken img', () => {
  const out = md('![a lit doorway](gen:a single lit doorway at the end of a dark corridor)');
  assert.match(out, /class="genimg"/);
  assert.match(out, /data-prompt="a single lit doorway at the end of a dark corridor"/);
  assert.match(out, /data-alt="a lit doorway"/);
  assert.match(out, /<figcaption>a lit doorway<\/figcaption>/);
  assert.ok(!out.includes('<img'), 'no src is emitted until the server has drawn it');
});

test('a gen: prompt containing quotes or angle brackets is escaped into the attribute', () => {
  const out = md('![c](gen:a "bright" <spark> & a dark room)');
  assert.ok(out.includes('&quot;bright&quot;'));
  assert.ok(out.includes('&lt;spark&gt;'));
  assert.ok(!/data-prompt="[^"]*"[a-z]/i.test(out), 'attribute cannot be broken out of');
});

test('ordinary http images and unsafe schemes are unaffected', () => {
  assert.match(md('![x](https://e.com/a.png)'), /<img alt="x" src="https:\/\/e\.com\/a\.png"/);
  assert.ok(!md('![x](data:text/html,hi)').includes('<img'));
  assert.ok(!md('![x](javascript:alert(1))').includes('<img'));
});

test('image capability is advertised to the model only when a key exists', () => {
  const lesson = TOOLS.find(t => t.name === 'create_lesson');
  const deck = TOOLS.find(t => t.name === 'create_deck');
  const layouts = deck.input_schema.properties.slides.items.properties.layout.enum;
  if (images.enabled()) {
    assert.match(lesson.description, /gen:/, 'lessons should offer illustrations');
    assert.ok(layouts.includes('image'));
  } else {
    assert.ok(!/gen:/.test(lesson.description), 'must not offer illustrations with no key');
    assert.ok(!layouts.includes('image'), 'image layout must not be selectable with no key');
  }
});

test('generate refuses cleanly when unconfigured rather than throwing something opaque', async () => {
  if (images.enabled()) return; // nothing to assert when a key is present
  await assert.rejects(() => images.generate('anything'), /GEMINI_API_KEY|OPENAI_API_KEY/);
});

test('cache paths are hash-shaped and confined to the image directory', () => {
  const p = images.imagePath('a'.repeat(64));
  assert.match(p, /[\\/]data[\\/]images[\\/]a{64}\.png$/);
});
