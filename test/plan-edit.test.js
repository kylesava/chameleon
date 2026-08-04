const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');

function seeded() {
  const S = makeStore(open(':memory:'));
  const s = S.createSession();
  const plan = S.setPlan(s.id, 'Goals', [
    { title: 'first', detail: 'a' },
    { title: 'second', stage: 1 },
  ]);
  return { S, sid: s.id, plan };
}

test('renaming a goal keeps everything else intact', () => {
  const { S, plan } = seeded();
  const t = S.updateTask(plan.tasks[0].id, { title: '  Trace the handshake  ' });
  assert.equal(t.title, 'Trace the handshake', 'trimmed');
  assert.equal(t.detail, 'a', 'detail untouched');
  assert.equal(t.status, 'todo');
});

test('a goal can never be renamed to nothing', () => {
  const { S, plan } = seeded();
  const before = S.getTask(plan.tasks[0].id).title;
  assert.equal(S.updateTask(plan.tasks[0].id, { title: '   ' }).title, before);
});

test('detail can be edited independently of the title', () => {
  const { S, plan } = seeded();
  const t = S.updateTask(plan.tasks[0].id, { detail: 'why it matters' });
  assert.equal(t.title, 'first');
  assert.equal(t.detail, 'why it matters');
});

test('removing a goal drops it from the plan and leaves the rest ordered', () => {
  const { S, sid, plan } = seeded();
  assert.equal(S.deleteTask(plan.tasks[0].id), true);
  const after = S.getPlan(sid);
  assert.deepEqual(after.tasks.map(t => t.title), ['second']);
  assert.equal(S.deleteTask(plan.tasks[0].id), false, 'deleting twice is not an error state');
});

test('adding a goal appends it to the live plan as todo', () => {
  const { S, sid } = seeded();
  const t = S.addTask(sid, 'Explain it back to me');
  assert.equal(t.status, 'todo');
  const after = S.getPlan(sid);
  assert.equal(after.tasks.length, 3);
  assert.ok(after.tasks.some(x => x.title === 'Explain it back to me'));
});

test('adding a goal lands in the last stage by default', () => {
  const { S, sid } = seeded();
  assert.equal(S.addTask(sid, 'later').stage, 1);
  assert.equal(S.addTask(sid, 'explicit', { stage: 0 }).stage, 0);
});

test('adding to a session with no plan reports rather than throwing', () => {
  const S = makeStore(open(':memory:'));
  const s = S.createSession();
  assert.equal(S.addTask(s.id, 'nope'), null);
});

test('unknown task ids are handled, not thrown', () => {
  const { S } = seeded();
  assert.equal(S.updateTask(99999, { title: 'x' }), null);
  assert.equal(S.deleteTask(99999), false);
});

test('overlong text is clamped rather than rejected', () => {
  const { S, plan } = seeded();
  const t = S.updateTask(plan.tasks[0].id, { title: 'x'.repeat(400), detail: 'y'.repeat(900) });
  assert.equal(t.title.length, 300);
  assert.equal(t.detail.length, 500);
});
