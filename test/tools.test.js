const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');
const { TOOLS, makeExecutors, applyLayoutActions } = require('../server/tools.js');

function ctx() {
  const store = makeStore(open(':memory:'));
  const session = store.createSession();
  const events = [];
  let layout = [];
  const executors = makeExecutors({
    store, sessionId: session.id,
    emit: e => events.push(e),
    layout: { get: () => layout, set: l => { layout = l; } },
  });
  return { store, session, events, executors, layout: () => layout };
}

test('every tool has an executor', () => {
  const { executors } = ctx();
  for (const t of TOOLS) assert.equal(typeof executors[t.name], 'function', t.name);
});

test('applyLayoutActions: open/resize/close/close_all + junk ignored', () => {
  let r = applyLayoutActions([], [{ type: 'open', app: 'plan', size: 'm', focus: true }]);
  assert.deepEqual(r.layout, [{ app: 'plan', size: 'm', focus: true }]);
  r = applyLayoutActions(r.layout, [
    { type: 'resize', app: 'plan', size: 'xl' },
    { type: 'open', app: 'nope' },
    { type: 'resize', app: 'plan', size: 'huge' },
  ]);
  assert.equal(r.layout[0].size, 'xl');
  assert.equal(r.applied.length, 1);
  r = applyLayoutActions(r.layout, [{ type: 'close_all' }]);
  assert.deepEqual(r.layout, []);
});

test('update_plan persists, emits, and opens the plan tile', () => {
  const { executors, store, session, events } = ctx();
  const out = executors.update_plan({ title: 'Learn X', tasks: [{ title: 'a' }, { title: 'b', stage: 1 }] });
  assert.match(out, /Plan saved/);
  assert.match(out, /#\d+/); // ids surfaced so the model can set statuses later
  assert.equal(store.getPlan(session.id).tasks.length, 2);
  assert.ok(events.some(e => e.t === 'plan'));
  assert.ok(events.some(e => e.t === 'action' && e.a.type === 'open' && e.a.app === 'plan'));
});

test('set_task_status updates and re-emits the plan', () => {
  const { executors, store, session, events } = ctx();
  executors.update_plan({ title: 'p', tasks: [{ title: 'a' }] });
  const id = store.getPlan(session.id).tasks[0].id;
  events.length = 0;
  const out = executors.set_task_status({ tasks: [{ id, status: 'done' }] });
  assert.match(out, /done/);
  assert.equal(store.getPlan(session.id).tasks[0].status, 'done');
  assert.ok(events.some(e => e.t === 'plan'));
});

test('create_quiz validates questions and saves the artifact', () => {
  const { executors, store, session, events } = ctx();
  assert.throws(() => executors.create_quiz({ title: 'bad', questions: [{ type: 'mc', prompt: 'x' }] }));
  const out = executors.create_quiz({
    title: 'Check',
    questions: [
      { type: 'mc', prompt: 'q1', choices: ['a', 'b'], answer_index: 1, explain: 'because' },
      { type: 'free', prompt: 'q2' },
    ],
  });
  assert.match(out, /2 questions/);
  const art = store.latestArtifact(session.id, 'quiz');
  assert.equal(art.data.questions.length, 2);
  assert.ok(events.some(e => e.t === 'artifact' && e.app === 'quiz'));
  assert.ok(events.some(e => e.t === 'action' && e.a.app === 'quiz'));
});

test('create_lesson revises in place with artifact_id', () => {
  const { executors, store, session } = ctx();
  executors.create_lesson({ title: 'L1', sections: [{ heading: 'h', body: 'b' }] });
  const first = store.latestArtifact(session.id, 'lesson');
  executors.create_lesson({ title: 'L1 v2', sections: [{ heading: 'h', body: 'b' }, { heading: 'h2', body: 'b2' }], artifact_id: first.id });
  const after = store.latestArtifact(session.id, 'lesson');
  assert.equal(after.id, first.id);
  assert.equal(after.data.sections.length, 2);
  assert.equal(store.listArtifacts(session.id).length, 1);
});

test('narrate mirrors into chat history', () => {
  const { executors, store, session, events } = ctx();
  executors.narrate({ app: 'plan', text: 'Building your plan.' });
  const msgs = store.listMessages(session.id);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, 'narration');
  assert.equal(msgs[0].app, 'plan');
  assert.ok(events.some(e => e.t === 'narrate'));
});

test('add_note lands in the notebook as a note source', () => {
  const { executors, store, session } = ctx();
  executors.add_note({ title: 'Key idea', content: 'Attention is weighted averaging.' });
  const s = store.listSources(session.id);
  assert.equal(s.length, 1);
  assert.equal(s[0].kind, 'note');
});
