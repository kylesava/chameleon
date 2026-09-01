const test = require('node:test');
const assert = require('node:assert');
const { draftScan, DRAFTABLE, TOOLS } = require('../server/tools.js');

/* draftScan reads a tool input that is still arriving. Complete elements come
   back as-is; the element still being written comes back flagged _partial with
   whatever text has landed, so a lesson body can be watched filling in. */

test('the element being written streams out, flagged partial', () => {
  const s = '{"title":"Lesson","sections":[{"heading":"Intro","body":"GPS is a stopwa';
  const { items } = draftScan(s, 'sections');
  assert.equal(items.length, 1);
  assert.equal(items[0].heading, 'Intro');
  assert.equal(items[0].body, 'GPS is a stopwa');
  assert.equal(items[0]._partial, true);
});

test('partial text grows across deltas and is never truncated backwards', () => {
  const base = '{"sections":[{"heading":"H","body":"';
  let prev = '';
  for (const chunk of ['a', 'ab', 'abc', 'abcd efg', 'abcd efg hij']) {
    const { items } = draftScan(base + chunk, 'sections');
    assert.equal(items[0].body, chunk);
    assert.ok(chunk.startsWith(prev), 'text only ever extends');
    prev = chunk;
  }
});

test('a completed element loses the partial flag', () => {
  const done = '{"sections":[{"heading":"Intro","body":"all of it"}';
  const { items } = draftScan(done, 'sections');
  assert.equal(items[0]._partial, undefined);
  assert.equal(items[0].body, 'all of it');
});

test('top-level scalars (the title) surface before the array completes', () => {
  const { head } = draftScan('{"title":"How GPS works","sections":[{"heading":"a', 'sections');
  assert.equal(head.title, 'How GPS works');
});

test('a half-written key is dropped rather than shown as garbage', () => {
  const { items } = draftScan('{"sections":[{"heading":"Intro","bod', 'sections');
  assert.equal(items.length, 1);
  assert.equal(items[0].heading, 'Intro');
  assert.ok(!('bod' in items[0]));
});

test('a dangling comma or colon does not break the read', () => {
  for (const tail of ['{"heading":"Intro",', '{"heading":"Intro","body":', '{"heading":"Intro","body":"']) {
    const { items } = draftScan('{"sections":[' + tail, 'sections');
    assert.equal(items[0].heading, 'Intro');
  }
});

test('escaped quotes and braces inside the streaming text stay intact', () => {
  const s = '{"sections":[{"body":"he said \\"hi\\" and {braces} and \\\\ too';
  const { items } = draftScan(s, 'sections');
  assert.equal(items[0].body, 'he said "hi" and {braces} and \\ too');
});

test('multiple completed elements plus a partial tail', () => {
  const s = '{"questions":[{"prompt":"one"},{"prompt":"two"},{"prompt":"thr';
  const { items } = draftScan(s, 'questions');
  assert.deepEqual(items.map(q => q.prompt), ['one', 'two', 'thr']);
  assert.equal(items[0]._partial, undefined);
  assert.equal(items[2]._partial, true);
});

test('nested structures inside an element survive', () => {
  const s = '{"questions":[{"prompt":"p","choices":["a","b"],"answer_index":1}';
  const { items } = draftScan(s, 'questions');
  assert.deepEqual(items[0].choices, ['a', 'b']);
  assert.equal(items[0].answer_index, 1);
});

test('stops at the end of the target array', () => {
  const s = '{"questions":[{"prompt":"one"}],"other":[{"prompt":"nope"}]}';
  const { items } = draftScan(s, 'questions');
  assert.deepEqual(items.map(q => q.prompt), ['one']);
});

test('missing field or empty input yields nothing', () => {
  assert.deepEqual(draftScan('{"title":"x"}', 'questions').items, []);
  assert.deepEqual(draftScan('', 'questions').items, []);
  assert.deepEqual(draftScan('{"questions"', 'questions').items, []);
});

test('replaying a full stream one character at a time stays coherent', () => {
  const full = JSON.stringify({
    title: 'Deck',
    cards: [{ q: 'q1', a: 'a1' }, { q: 'q2 with "quotes"', a: 'a2 {braces}' }, { q: 'q3', a: 'a3' }],
  });
  let count = 0;
  for (let i = 1; i <= full.length; i++) {
    const { items } = draftScan(full.slice(0, i), 'cards');
    assert.ok(items.length >= count, 'item count never goes backwards');
    count = items.length;
    for (const it of items) {
      // every key present must hold a usable value, partial or not
      for (const [k, v] of Object.entries(it)) {
        if (k === '_partial') continue;
        assert.ok(typeof v === 'string', `${k} is readable text`);
      }
    }
  }
  const final = draftScan(full, 'cards');
  assert.equal(final.items.length, 3);
  assert.ok(final.items.every(i => !i._partial), 'nothing is left flagged partial once complete');
  assert.equal(final.head.title, 'Deck');
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
