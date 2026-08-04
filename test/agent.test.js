const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');
const { stateDigest, historyMessages, echoSafe } = require('../server/agent.js');
const { htmlToText } = require('../server/api.js');

function seeded() {
  const store = makeStore(open(':memory:'));
  const s = store.createSession('Journey');
  return { store, id: s.id };
}

test('stateDigest covers sources, plan, artifacts, workspace', () => {
  const { store, id } = seeded();
  store.addSource(id, 'text', 'My notes', 'mitochondria are the powerhouse');
  store.setPlan(id, 'Bio', [{ title: 'Cells' }]);
  store.saveArtifact(id, 'quiz', 'Cell quiz', { questions: [] });
  const d = stateDigest(store, id, [{ app: 'plan', size: 'm', focus: true }]);
  assert.match(d, /source #\d+ \(text\) "My notes"/);
  assert.match(d, /mitochondria/);
  assert.match(d, /PLAN "Bio"/);
  assert.match(d, /quiz "Cell quiz"/);
  assert.match(d, /plan\(m, focused\)/);
});

test('stateDigest truncates giant sources', () => {
  const { store, id } = seeded();
  store.addSource(id, 'text', 'Big', 'x'.repeat(10000));
  const d = stateDigest(store, id, []);
  assert.ok(d.includes('[truncated]'));
  assert.ok(d.length < 5000);
});

test('historyMessages flattens, merges same-role runs, skips narration, starts with user', () => {
  const { store, id } = seeded();
  store.addMessage(id, 'assistant', 'orphan greeting', 'chat'); // dropped: leading assistant
  store.addMessage(id, 'user', 'teach me', 'chat');
  store.addMessage(id, 'user', '[UI EVENT] clicked something', 'event');
  store.addMessage(id, 'assistant', 'narrating', 'narration', 'plan'); // skipped
  store.addMessage(id, 'assistant', 'reply', 'chat');
  const msgs = historyMessages(store, id);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'user');
  assert.ok(msgs[0].content.includes('teach me') && msgs[0].content.includes('UI EVENT'));
  assert.equal(msgs[1].role, 'assistant');
  assert.equal(msgs[1].content, 'reply');
});

test('echoSafe: no fallback → untouched', () => {
  const content = [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'hi' },
    { type: 'tool_use', id: 't1', name: 'layout', input: {} },
  ];
  const { content: out, toolIds } = echoSafe(content);
  assert.deepEqual(out, content);
  assert.ok(toolIds.has('t1'));
});

test('echoSafe: pre-fallback thinking/tool_use dropped, post-fallback kept', () => {
  const content = [
    { type: 'thinking', thinking: '' },
    { type: 'tool_use', id: 'dead', name: 'layout', input: {} },
    { type: 'text', text: 'partial' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'tool_use', id: 'live', name: 'narrate', input: {} },
  ];
  const { content: out, toolIds } = echoSafe(content);
  assert.ok(!out.some(b => b.id === 'dead'));
  assert.ok(!out.some(b => b.type === 'thinking'));
  assert.ok(out.some(b => b.type === 'text'));
  assert.ok(toolIds.has('live') && !toolIds.has('dead'));
});

test('htmlToText strips scripts/styles/tags and decodes entities', () => {
  const t = htmlToText('<html><head><style>.x{}</style><script>evil()</script></head><body><h1>Hello &amp; hi</h1><p>a</p><p>b</p></body></html>');
  assert.ok(!t.includes('evil'));
  assert.ok(!t.includes('.x{}'));
  assert.match(t, /Hello & hi/);
  assert.match(t, /a\n\s*b/);
});
