const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');

function fresh() {
  return makeStore(open(':memory:'));
}

test('sessions: create, list, layout roundtrip', () => {
  const S = fresh();
  const s = S.createSession('Transformers');
  assert.equal(s.title, 'Transformers');
  S.saveLayout(s.id, [{ app: 'plan', size: 'm', focus: true }]);
  const back = JSON.parse(S.getSession(s.id).layout_json);
  assert.deepEqual(back, [{ app: 'plan', size: 'm', focus: true }]);
  assert.equal(S.listSessions().length, 1);
});

test('messages: append and ordered listing', () => {
  const S = fresh();
  const s = S.createSession();
  S.addMessage(s.id, 'user', 'teach me', 'chat');
  S.addMessage(s.id, 'assistant', 'here we go', 'chat');
  S.addMessage(s.id, 'assistant', 'building your plan', 'narration', 'plan');
  const m = S.listMessages(s.id);
  assert.equal(m.length, 3);
  assert.equal(m[0].content, 'teach me');
  assert.equal(m[2].kind, 'narration');
  assert.equal(m[2].app, 'plan');
});

test('plan: latest wins, stages ordered, status transitions', () => {
  const S = fresh();
  const s = S.createSession();
  S.setPlan(s.id, 'v1', [{ title: 'old' }]);
  const p = S.setPlan(s.id, 'v2', [
    { title: 'b', stage: 1 },
    { title: 'a', stage: 0, detail: 'first' },
    { title: 'c', stage: 1, status: 'doing' },
  ]);
  assert.equal(S.getPlan(s.id).title, 'v2');
  assert.deepEqual(p.tasks.map(t => t.title), ['a', 'b', 'c']); // stage-sorted
  const done = S.setTaskStatus(p.tasks[0].id, 'done');
  assert.equal(done.status, 'done');
  assert.throws(() => S.setTaskStatus(p.tasks[0].id, 'bogus'));
});

test('sources: add/list/delete', () => {
  const S = fresh();
  const s = S.createSession();
  const src = S.addSource(s.id, 'text', 'Notes', 'hello world');
  assert.equal(S.listSources(s.id).length, 1);
  S.deleteSource(src.id);
  assert.equal(S.listSources(s.id).length, 0);
});

test('artifacts: create, revise in place, latest per app', () => {
  const S = fresh();
  const s = S.createSession();
  const a1 = S.saveArtifact(s.id, 'quiz', 'Quiz 1', { questions: [1] });
  const a2 = S.saveArtifact(s.id, 'quiz', 'Quiz 2', { questions: [1, 2] });
  assert.equal(S.latestArtifact(s.id, 'quiz').id, a2.id);
  const revised = S.saveArtifact(s.id, 'quiz', 'Quiz 1 v2', { questions: [1, 2, 3] }, a1.id);
  assert.equal(revised.id, a1.id);
  assert.equal(revised.data.questions.length, 3);
  assert.equal(S.listArtifacts(s.id).length, 2);
});

test('quiz attempts persist with score', () => {
  const S = fresh();
  const s = S.createSession();
  const q = S.saveArtifact(s.id, 'quiz', 'Q', { questions: [] });
  S.addAttempt(q.id, [0, 'free text'], 0.5);
  const at = S.listAttempts(q.id);
  assert.equal(at.length, 1);
  assert.equal(at[0].score, 0.5);
  assert.deepEqual(at[0].answers, [0, 'free text']);
});
