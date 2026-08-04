const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');

const fresh = () => makeStore(open(':memory:'));

test('pruneEmptySessions removes only sessions that never became anything', () => {
  const S = fresh();
  const blank = S.createSession('New journey');
  const withMsg = S.createSession('has a message');
  S.addMessage(withMsg.id, 'user', 'hi');
  const withSource = S.createSession('has a source');
  S.addSource(withSource.id, 'text', 'notes', 'body');
  const withArtifact = S.createSession('has an artifact');
  S.saveArtifact(withArtifact.id, 'lesson', 'L', { sections: [] });
  const withPlan = S.createSession('has a plan');
  S.setPlan(withPlan.id, 'p', [{ title: 'a' }]);

  assert.equal(S.pruneEmptySessions(), 1);
  const left = S.listSessions().map(s => s.id).sort();
  assert.deepEqual(left, [withMsg.id, withSource.id, withArtifact.id, withPlan.id].sort());
  assert.equal(S.getSession(blank.id), undefined);
});

test('pruneEmptySessions can spare the session currently in use', () => {
  const S = fresh();
  const keep = S.createSession('New journey');
  S.createSession('another blank');
  assert.equal(S.pruneEmptySessions(keep.id), 1);
  assert.ok(S.getSession(keep.id));
});

test('pruning is safe to run repeatedly and on an empty database', () => {
  const S = fresh();
  assert.equal(S.pruneEmptySessions(), 0);
  S.createSession();
  assert.equal(S.pruneEmptySessions(), 1);
  assert.equal(S.pruneEmptySessions(), 0);
});
