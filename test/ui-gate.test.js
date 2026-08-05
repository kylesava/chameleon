/* The sign-in gate and the baseline questionnaire, driven in a real browser.
   These are the first two screens anyone ever sees, so they get the most
   pedantic test in the suite. */
const test = require('node:test');
const assert = require('node:assert');
const { open, serve, sleep } = require('./drive.js');

const SHOTS = require('node:path').join(__dirname, '..', 'data', 'shots');

test('gate: sign in, answer the baseline, land in the workspace', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  /* ---- the workspace must not be reachable before signing in ---- */
  await p.waitFor('document.querySelector("#gate-form")', 10000, 'login form');
  assert.equal(await p.eval('getComputedStyle(document.getElementById("shell")).opacity', false), '0',
    'the workspace must stay hidden behind the gate');
  const state = await p.eval('fetch("api/state").then(r => r.status)');
  assert.equal(state, 401, '/api/state must refuse an unauthenticated caller');

  /* ---- a wrong password fails visibly and lets you try again ---- */
  await p.fill('#gate-user', 'matt');
  await p.fill('#gate-pass', 'wrong');
  await p.click('#gate-form button');
  await p.waitFor('!document.querySelector(".gate-err").hidden', 8000, 'error message');
  assert.match(await p.text('.gate-err'), /./);
  assert.equal(await p.eval('document.querySelector("#gate-form button").disabled', false), false,
    'the button must re-enable so a mistyped password is recoverable');

  /* ---- the real password gets through to the one question ---- */
  await p.fill('#gate-pass', 'OldGuy');
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-options")', 12000, 'the one question');

  /* One question, not five. Everything else is learned from use or said in
     the chat — asking it up front is friction in front of someone who just
     wants to start. */
  assert.equal(await p.count('.gate-opt'), 3, 'three modes, one screen');
  assert.equal(await p.has('.gate-progress'), false, 'no multi-step questionnaire');
  assert.match(await p.text('#gate-body h1'), /how much at once/i);
  /* nothing asks how much they already know — that is per-topic, not per-person */
  assert.equal(await p.has('.gate-opt[data-v="novice"]'), false);
  await p.shot(SHOTS + '/gate-q1.png');

  await p.click('.gate-opt[data-v="simple"]');

  /* ---- the gate gets out of the way ---- */
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');
  await p.waitFor('getComputedStyle(document.getElementById("shell")).opacity === "1"', 8000, 'workspace visible');
  await p.shot(SHOTS + '/gate-done.png');

  /* ---- one answer set every parameter ---- */
  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.user.username, 'matt');
  assert.equal(me.profile.onboarded, true);
  assert.equal(me.profile.effective.mode, 'simple');
  assert.equal(me.profile.effective.maxApps, 1, 'one thing at a time means one window');
  assert.equal(me.profile.effective.checkinEvery, 'step');
  assert.equal(me.profile.effective.planPlace, 'chat', 'and the plan in the conversation');
  assert.equal(me.profile.effective.voice, 'chat', 'and the agent talking in the chat, not inside apps');

  /* ---- reload must not ask again ---- */
  await p.goto(app.url + '/');
  await p.waitFor('getComputedStyle(document.getElementById("shell")).opacity === "1"', 12000, 'straight into the workspace');
  assert.equal(await p.has('.gate-progress'), false, 'the baseline must only ever be asked once');

  assert.deepEqual(p.errors, [], 'no uncaught page errors');
});

test('gate: Kyle gets the opposite profile, and users cannot see each other', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await p.waitFor('document.querySelector("#gate-form")', 10000, 'login form');
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-options")', 12000, 'the one question');
  await p.click('.gate-opt[data-v="extreme"]');
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');

  /* the same single choice, pointed the other way, gives the opposite product */
  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.mode, 'extreme');
  assert.equal(me.profile.effective.maxApps, 4, 'roaming means several windows at once');
  assert.equal(me.profile.effective.checkinEvery, 'never');
  assert.equal(me.profile.effective.planPlace, 'window', 'Kyle keeps the plan beside the work');
  assert.equal(me.profile.effective.visuals, 'rich');

  /* Kyle starts a journey; Matt must never see it. */
  const mine = await p.eval(`fetch('api/session', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ title: 'Kyle only' }) }).then(r => r.json())`);
  assert.ok(mine.session && mine.session.id, 'creating a journey should return it');
  await p.eval('fetch("api/logout", { method: "POST" })');
  await p.eval(`fetch('api/login', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ username: 'matt', password: 'OldGuy' }) })`);
  const seen = await p.eval('fetch("api/state").then(r => r.json())');
  const titles = (seen.sessions || []).map(s => s.title);
  const reach = await p.eval(`fetch('api/state?session=${mine.session.id}').then(r => r.json()).then(j => j.session.id)`);
  assert.notEqual(reach, mine.session.id, "Matt must not be able to open Kyle's journey by id");
  assert.ok(!titles.includes('Kyle only'), `Matt must not see Kyle's journeys — saw ${JSON.stringify(titles)}`);

  assert.deepEqual(p.errors, [], 'no uncaught page errors');
});
