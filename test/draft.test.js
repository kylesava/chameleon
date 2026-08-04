const test = require('node:test');
const assert = require('node:assert');
const { draftScan, DRAFTABLE, TOOLS } = require('../server/tools.js');

/* draftScan reads a tool input that is still arriving: it must return every
   COMPLETE element so far and never a half-written one. */

test('returns nothing until the first object closes', () => {
  assert.deepEqual(draftScan('{"title":"Quiz","questions":[', 'questions'), []);
  assert.deepEqual(draftScan('{"title":"Quiz","questions":[{"type":"mc","prompt":"Why', 'questions'), []);
});

test('returns each object as it completes', () => {
  const a = '{"title":"Q","questions":[{"type":"mc","prompt":"one"}';
  assert.deepEqual(draftScan(a, 'questions'), [{ type: 'mc', prompt: 'one' }]);
  const b = a + ',{"type":"free","prompt":"two"}';
  assert.deepEqual(draftScan(b, 'questions').map(q => q.prompt), ['one', 'two']);
  const c = b + ',{"type":"mc","prompt":"thr';
  assert.deepEqual(draftScan(c, 'questions').map(q => q.prompt), ['one', 'two'], 'partial tail excluded');
});

test('handles nested objects and arrays inside an element', () => {
  const s = '{"questions":[{"prompt":"p","choices":["a","b"],"meta":{"x":{"y":1}},"answer_index":1}';
  const out = draftScan(s, 'questions');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].choices, ['a', 'b']);
  assert.equal(out[0].meta.x.y, 1);
});

test('braces and brackets inside strings do not confuse it', () => {
  const s = '{"questions":[{"prompt":"use {a} and [b] now"}';
  assert.deepEqual(draftScan(s, 'questions'), [{ prompt: 'use {a} and [b] now' }]);
});

test('escaped quotes and backslashes inside strings are handled', () => {
  const s = '{"questions":[{"prompt":"say \\"hi\\" then \\\\ done"}';
  const out = draftScan(s, 'questions');
  assert.equal(out.length, 1);
  assert.equal(out[0].prompt, 'say "hi" then \\ done');
});

test('stops at the end of the target array', () => {
  const s = '{"questions":[{"prompt":"one"}],"other":[{"prompt":"nope"}]}';
  assert.deepEqual(draftScan(s, 'questions').map(q => q.prompt), ['one']);
});

test('missing field or absent array yields nothing', () => {
  assert.deepEqual(draftScan('{"title":"x"}', 'questions'), []);
  assert.deepEqual(draftScan('', 'questions'), []);
  assert.deepEqual(draftScan('{"questions"', 'questions'), []);
});

test('a field that precedes the array in the payload is skipped correctly', () => {
  const s = '{"artifact_id":7,"title":"Deck","cards":[{"q":"a","a":"b"}';
  assert.deepEqual(draftScan(s, 'cards'), [{ q: 'a', a: 'b' }]);
});

test('replaying a full stream one character at a time never yields a partial item', () => {
  const full = JSON.stringify({
    title: 'Deck',
    cards: [{ q: 'q1', a: 'a1' }, { q: 'q2 with "quotes"', a: 'a2 {braces}' }, { q: 'q3', a: 'a3' }],
  });
  let seen = 0;
  for (let i = 1; i <= full.length; i++) {
    const items = draftScan(full.slice(0, i), 'cards');
    assert.ok(items.length >= seen, 'item count must never go backwards');
    for (const it of items) {
      assert.ok(typeof it.q === 'string' && typeof it.a === 'string', 'every emitted item is complete');
    }
    seen = items.length;
  }
  assert.equal(seen, 3);
});

test('every draftable tool names a real tool and a real array field', () => {
  for (const [toolName, spec] of Object.entries(DRAFTABLE)) {
    const tool = TOOLS.find(t => t.name === toolName);
    assert.ok(tool, `${toolName} is a real tool`);
    const prop = tool.input_schema.properties[spec.field];
    assert.ok(prop, `${toolName}.${spec.field} exists in the schema`);
    assert.equal(prop.type, 'array', `${toolName}.${spec.field} is an array`);
    assert.ok(spec.status && spec.app, `${toolName} has a status line and target app`);
  }
});
