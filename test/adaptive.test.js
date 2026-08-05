/* Auth, the learner profile, and the pacing budget.
   These three are the load-bearing pieces of "pace is a property of the
   learner, not of the product" — if any of them quietly stops working the app
   still looks fine and behaves wrongly, so they get direct tests. */
const test = require('node:test');
const assert = require('node:assert');
const { open } = require('../server/db.js');
const { makeStore } = require('../server/store.js');
const auth = require('../server/auth.js');
const profile = require('../server/profile.js');
const { makeExecutors } = require('../server/tools.js');

const fresh = () => makeStore(open(':memory:'));

/* ---------------- passwords and cookies ---------------- */

test('auth: a password verifies against its own hash and nothing else', () => {
  const h = auth.hashPassword('OldGuy');
  assert.ok(auth.verifyPassword('OldGuy', h));
  assert.equal(auth.verifyPassword('oldguy', h), false, 'case matters');
  assert.equal(auth.verifyPassword('OldGuy ', h), false);
  assert.equal(auth.verifyPassword('', h), false);
  assert.notEqual(h, auth.hashPassword('OldGuy'), 'the same password must salt differently each time');
  for (const junk of [null, undefined, '', 'nonsense', 'a:b', ':', 'ff:']) {
    assert.equal(auth.verifyPassword('OldGuy', junk), false, `malformed hash ${JSON.stringify(junk)} must not verify`);
  }
});

test('auth: a session token round-trips and cannot be forged', () => {
  const t = auth.issue(7);
  assert.equal(auth.read(t), 7);
  assert.equal(auth.read(null), null);
  assert.equal(auth.read('rubbish'), null);
  assert.equal(auth.read('9.' + Date.now() + '.notasignature'), null, 'a made-up signature must be rejected');
  const [id, issued, sig] = t.split('.');
  assert.equal(auth.read(`8.${issued}.${sig}`), null, 'swapping the user id must invalidate the signature');
  assert.equal(auth.read(`${id}.${Date.now() - 40 * 24 * 3600 * 1000}.${sig}`), null, 'an expired token must be rejected');
});

test('auth: users are stored lower-case and passwords are never kept in the clear', () => {
  const S = fresh();
  const u = S.createUser('Matt', 'OldGuy', 'Matt');
  assert.equal(u.username, 'matt');
  assert.ok(S.getUserByName('MATT'), 'lookup should be case-insensitive');
  assert.ok(!/OldGuy/.test(JSON.stringify(u)), 'the plaintext password must not survive anywhere on the row');
  assert.ok(auth.verifyPassword('OldGuy', u.pass_hash));
});

/* ---------------- the profile ---------------- */

test('profile: the two personas derive the settings they described', () => {
  const matt = profile.derive({ stated: { parallelism: 1, checkins: 'every-step', depth: 'thorough', priorKnowledge: 'novice' } });
  assert.equal(matt.maxApps, 1);
  assert.equal(matt.checkinEvery, 'step');
  assert.equal(matt.depth, 'thorough');

  const kyle = profile.derive({ stated: { parallelism: 4, checkins: 'rarely', depth: 'concise', priorKnowledge: 'strong' } });
  assert.equal(kyle.maxApps, 4);
  assert.equal(kyle.checkinEvery, 'never');
  assert.equal(kyle.depth, 'concise');
});

test('profile: a junk or empty profile still derives something usable', () => {
  for (const junk of [null, undefined, {}, { stated: null }, { stated: { parallelism: 99, checkins: 'whenever', depth: 'x' } }]) {
    const e = profile.derive(junk);
    assert.ok(e.maxApps >= 1 && e.maxApps <= 4, `maxApps out of range for ${JSON.stringify(junk)}`);
    assert.ok(['step', 'stage', 'never'].includes(e.checkinEvery));
    assert.ok(['concise', 'balanced', 'thorough'].includes(e.depth));
  }
});

test('profile: behaviour overrides what they claimed, but only once there is enough of it', () => {
  /* Someone who said "open everything" but keeps shutting windows and asking
     to slow down should end up with a smaller budget — after we have watched
     them long enough to be confident, not on the first click. */
  let p = { stated: { parallelism: 4, checkins: 'rarely', depth: 'concise' } };
  p = profile.applySignal(p, 'tile_closed_fast');
  p = profile.applySignal(p, 'slow_down');
  assert.equal(profile.derive(p).maxApps, 4, 'two signals is not evidence — do not thrash their settings');

  for (let i = 0; i < 12; i++) p = profile.applySignal(p, 'step_completed');
  for (let i = 0; i < 3; i++) { p = profile.applySignal(p, 'tile_closed_fast'); p = profile.applySignal(p, 'slow_down'); }
  const e = profile.derive(p);
  assert.ok(e.maxApps < 4, `sustained "this is too much" must shrink the budget (got ${e.maxApps})`);
  assert.equal(e.checkinEvery, 'step', 'asking to slow down repeatedly should turn check-ins back on');
  assert.ok(e.confidence > 0.5);
});

test('profile: struggling on quizzes deepens the teaching, breezing them lightens it', () => {
  let hard = { stated: { parallelism: 2, checkins: 'every-stage', depth: 'concise' } };
  hard = profile.applySignal(hard, 'quiz_score', 0.3);
  hard = profile.applySignal(hard, 'quiz_score', 0.2);
  assert.notEqual(profile.derive(hard).depth, 'concise', 'failing quizzes should not leave them on the shortest explanations');

  let easy = { stated: { parallelism: 2, checkins: 'every-stage', depth: 'thorough' } };
  easy = profile.applySignal(easy, 'quiz_score', 1);
  easy = profile.applySignal(easy, 'quiz_score', 0.95);
  assert.equal(profile.derive(easy).depth, 'balanced', 'someone acing everything does not need the long version');
});

test('profile: an unknown signal is ignored rather than fatal', () => {
  const p = profile.applySignal({ stated: {} }, 'not_a_real_signal', 5);
  assert.ok(profile.derive(p).maxApps >= 1);
});

test('profile: which windows they actually use feeds back as a preference', () => {
  let p = { stated: {} };
  for (let i = 0; i < 4; i++) p = profile.applySignal(p, 'app_used', 'quiz');
  p = profile.applySignal(p, 'app_used', 'podcast');
  assert.equal(profile.derive(p).preferredApps[0], 'quiz');
});

test('profile: the brief tells the model what to do, not what the numbers are', () => {
  const one = profile.brief(profile.derive({ stated: { parallelism: 1, checkins: 'every-step', depth: 'thorough' } }));
  assert.match(one, /ONE WORKING WINDOW AT A TIME/);
  assert.match(one, /CHECK IN AFTER EVERY STEP/);
  const many = profile.brief(profile.derive({ stated: { parallelism: 4, checkins: 'rarely', depth: 'concise' } }));
  assert.match(many, /Up to 4 working windows/);
  assert.match(many, /momentum/i);
  /* Both must say the plan is exempt — without it a model told to keep one
     window open closes the plan to make room, which is what happened live. */
  for (const b of [one, many]) assert.match(b, /plan window does NOT count/);
});

test('profile: signals persist and reshape the stored profile', () => {
  const S = fresh();
  const u = S.createUser('kyle', 'YoungGuy', 'Kyle');
  S.saveProfile(u.id, { onboarded: true, stated: { parallelism: 4, checkins: 'rarely', depth: 'concise' } });
  for (let i = 0; i < 14; i++) S.recordSignal(u.id, null, 'step_completed');
  for (let i = 0; i < 4; i++) S.recordSignal(u.id, null, 'slow_down');
  const e = profile.derive(S.getProfile(u.id));
  assert.equal(e.checkinEvery, 'step', 'the stored profile must actually change, not just the in-memory copy');
  assert.ok(S.listSignals(u.id).length >= 18, 'every signal is kept so we can audit why a profile drifted');
});

/* ---------------- the budget, enforced ---------------- */

function harness(maxApps, allowedApps) {
  const S = fresh();
  const u = S.createUser('u', 'p', 'U');
  const s = S.createSession('J', u.id);
  let layout = [];
  const ex = makeExecutors({
    store: S,
    sessionId: s.id,
    maxApps,
    allowedApps,
    emit: () => {},
    layout: { get: () => layout, set: l => { layout = l; } },
  });
  return { S, s, ex, open: () => layout.map(a => a.app) };
}

const openOne = (h, app) => h.ex.layout({ actions: [{ type: 'open', app, size: 'm' }] });

test('pacing: a one-window learner cannot be handed two windows in a turn', () => {
  const h = harness(1);
  openOne(h, 'lesson');
  assert.deepEqual(h.open(), ['lesson'], 'the first window is allowed');
  assert.match(openOne(h, 'quiz'), /Refused/, 'the second must be refused, not merely discouraged');
  assert.deepEqual(h.open(), ['lesson'], 'and the refused window must not actually open');
});

test('pacing: a four-window learner gets four and no more', () => {
  const h = harness(4);
  for (const app of ['lesson', 'quiz', 'flashcards', 'podcast']) openOne(h, app);
  assert.equal(h.open().length, 4);
  assert.match(openOne(h, 'deck'), /Refused/);
  assert.equal(h.open().length, 4, 'the budget is a ceiling, not a suggestion');
});

test('pacing: re-opening something already on screen is free', () => {
  const h = harness(1);
  openOne(h, 'lesson');
  assert.ok(!/Refused/.test(openOne(h, 'lesson')),
    'focusing a window that is already open is not a new window');
});

test('pacing: the plan window is outside the budget', () => {
  const h = harness(1);
  h.ex.update_plan({
    title: 'T',
    tasks: [{ title: 'a', done_when: 'x' }, { title: 'b', done_when: 'y' }],
  });
  assert.ok(h.open().includes('plan'));
  openOne(h, 'lesson');
  assert.ok(h.open().includes('lesson'), "showing the plan must not spend the learner's single window");
});

test('pacing: every step must say what finished looks like', () => {
  const h = harness(2);
  assert.throws(() => h.ex.update_plan({ title: 'T', tasks: [{ title: 'vague' }] }),
    /done_when/i, 'a step with no completion test is exactly the guesswork we removed');
  assert.equal(h.S.getPlan(h.s.id), null, 'and the vague plan must never reach the learner');
});

test('pacing: a plan always has exactly one live step', () => {
  const h = harness(2);
  h.ex.update_plan({
    title: 'T',
    tasks: [{ title: 'a', done_when: 'x' }, { title: 'b', done_when: 'y' }, { title: 'c', done_when: 'z' }],
  });
  const plan = h.S.getPlan(h.s.id);
  assert.equal(plan.tasks.filter(t => t.status === 'doing').length, 1);
  assert.equal(plan.tasks[0].status, 'doing', 'the first unfinished step is the live one');
});

test('pacing: advancing walks the spine one step at a time and stops at the end', () => {
  const S = fresh();
  const u = S.createUser('u', 'p', 'U');
  const s = S.createSession('J', u.id);
  S.setPlan(s.id, 'T', [
    { title: 'a', done_when: 'x', status: 'doing' },
    { title: 'b', done_when: 'y' },
  ]);
  let r = S.advancePlan(s.id);
  assert.equal(r.completed.title, 'a');
  assert.equal(r.next.title, 'b');
  assert.equal(r.plan.tasks.filter(t => t.status === 'doing').length, 1);

  r = S.advancePlan(s.id);
  assert.equal(r.completed.title, 'b');
  assert.equal(r.next, null, 'the end of the plan is the end, not a wrap-around');
  assert.equal(r.plan.tasks.every(t => t.status === 'done'), true);

  r = S.advancePlan(s.id);
  assert.equal(r.completed, null, 'advancing a finished plan is a no-op, not a crash');
});

/* ---------------- the plan window is not the agent's to close ---------------- */

test('spine: the agent cannot close the plan window, however tight the budget', () => {
  const h = harness(1);
  h.ex.update_plan({ title: 'T', tasks: [{ title: 'a', done_when: 'x' }] });
  assert.ok(h.open().includes('plan'));

  const out = h.ex.layout({ actions: [{ type: 'close', app: 'plan' }] });
  assert.ok(h.open().includes('plan'), 'a one-window learner most needs to see where they are');
  assert.match(out, /never yours to close/i, 'and the model must be told why, so it stops trying');
});

test('spine: close_all sweeps the workspace but leaves the plan standing', () => {
  const h = harness(4);
  h.ex.update_plan({ title: 'T', tasks: [{ title: 'a', done_when: 'x' }] });
  openOne(h, 'lesson');
  openOne(h, 'quiz');
  h.ex.layout({ actions: [{ type: 'close_all' }] });
  assert.deepEqual(h.open(), ['plan'], 'everything goes except the spine');
});

test('spine: with no plan yet, close_all still means close everything', () => {
  const h = harness(4);
  openOne(h, 'lesson');
  openOne(h, 'quiz');
  h.ex.layout({ actions: [{ type: 'close_all' }] });
  assert.deepEqual(h.open(), []);
});

test('pacing: showing the plan again must not spend the whole budget', () => {
  /* The prompt tells the model to show the plan early, so it issues an open
     for a tile update_plan has already opened. Counting that no-op used to
     exhaust a one-window learner's budget before any teaching could start —
     every lesson and quiz that turn came back "Refused". */
  const h = harness(1);
  h.ex.update_plan({ title: 'T', tasks: [{ title: 'a', done_when: 'x' }] });
  const noop = h.ex.layout({ actions: [{ type: 'open', app: 'plan', size: 'm', focus: true }] });
  assert.ok(!/Refused/.test(noop));
  const lesson = h.ex.create_lesson({ title: 'L', sections: [{ heading: 'h', body: 'b' }] });
  assert.match(lesson, /saved/, 'the teaching window must still be available');
  assert.ok(h.open().includes('lesson'));
});

test('pacing: a refused window leaves nothing behind', () => {
  /* Saving the artifact before checking the budget meant each refused retry
     stacked up another copy of the same lesson in the notebook. */
  const h = harness(1);
  h.ex.create_lesson({ title: 'First', sections: [{ heading: 'h', body: 'b' }] });
  const before = h.S.listArtifacts(h.s.id).length;
  assert.throws(() => h.ex.create_quiz({
    title: 'Second',
    questions: [{ type: 'mc', prompt: 'p', choices: ['a', 'b'], answer_index: 0 }],
  }), /Refused/);
  assert.equal(h.S.listArtifacts(h.s.id).length, before, 'a refused create must not persist anything');
});

test('content: a malformed lesson is refused rather than saved and left to crash the tile', () => {
  const h = harness(4);
  for (const bad of [undefined, null, 'not an array', {}, [], [{}], [null]]) {
    assert.throws(() => h.ex.create_lesson({ title: 'L', sections: bad }), /sections/i,
      `sections=${JSON.stringify(bad)} should be refused`);
  }
  assert.equal(h.S.listArtifacts(h.s.id).length, 0, 'nothing malformed reaches the database');
});


/* ---------------- windows the learner has switched off ---------------- */

test('settings: a switched-off window cannot be opened or built', () => {
  const h = harness(4, ['lesson', 'quiz']);
  assert.match(openOne(h, 'podcast'), /turned the podcast window off/i);
  assert.ok(!h.open().includes('podcast'), 'and it must not actually open');
  assert.throws(() => h.ex.create_podcast({ title: 'P', lines: [{ host: 'A', text: 'hi' }] }),
    /turned the podcast window off/i);
  assert.equal(h.S.listArtifacts(h.s.id).length, 0, 'nothing is written for a window they switched off');

  // and the ones they kept still work
  assert.match(h.ex.create_lesson({ title: 'L', sections: [{ heading: 'h', body: 'b' }] }), /saved/);
});

test('settings: the plan and notebook are structural and never switchable', () => {
  const h = harness(4, ['lesson']);
  h.ex.update_plan({ title: 'T', tasks: [{ title: 'a', done_when: 'x' }] });
  assert.ok(h.open().includes('plan'), 'the spine is not one of the optional windows');
  assert.ok(!/Refused/.test(openOne(h, 'sources')), 'nor is the notebook');
});

test('settings: with nothing switched off, everything is still available', () => {
  const h = harness(4, null);
  for (const app of ['lesson', 'quiz', 'flashcards', 'podcast']) {
    assert.ok(!/Refused/.test(openOne(h, app)), `${app} should be available by default`);
  }
});

test('settings: where the agent speaks reaches the brief as an instruction', () => {
  const windows = profile.brief(profile.derive({ stated: { voice: 'windows', chatter: 'minimal' } }));
  assert.match(windows, /SPEAK INSIDE THE WINDOWS/);
  assert.match(windows, /chat reply to one or two sentences/i);

  const chat = profile.brief(profile.derive({ stated: { voice: 'chat', chatter: 'full' } }));
  assert.match(chat, /SPEAK IN CHAT/);
  assert.ok(!/SPEAK INSIDE THE WINDOWS/.test(chat), 'the two must not both be asserted');

  const off = profile.brief(profile.derive({ stated: { apps: { podcast: false, deck: false } } }));
  assert.match(off, /TURNED OFF: podcast, deck/);
});
