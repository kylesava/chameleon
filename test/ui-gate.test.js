/* The sign-in gate and the baseline questionnaire, driven in a real browser.
   These are the first two screens anyone ever sees, so they get the most
   pedantic test in the suite. */
const test = require('node:test');
const assert = require('node:assert');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

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

  /* ---- the real password lands you straight in the product ---- */
  await p.fill('#gate-pass', 'OldGuy');
  await p.click('#gate-form button');
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');
  await p.waitFor('getComputedStyle(document.getElementById("shell")).opacity === "1"', 8000, 'workspace visible');

  /* Nothing is asked. Everyone starts at the same sensible pace; the dial is
     in settings, and the agent learns from use or from being told. */
  assert.equal(await p.has('#gate'), false, 'no setup screen at all');
  assert.equal(await p.has('.gate-go'), false, 'nothing to answer before starting');
  assert.equal(await p.has('.gate-progress'), false);
  assert.ok(await p.has('#chat-input'), 'straight to the composer');
  await p.shot(SHOTS + '/gate-done.png');

  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.user.username, 'matt');
  assert.equal(me.profile.onboarded, true, 'and they are counted as set up');
  assert.equal(me.profile.effective.mode, 'walk', 'on the middle of the dial');

  /* ---- reload must not ask again ---- */
  await p.goto(app.url + '/');
  await p.waitFor('getComputedStyle(document.getElementById("shell")).opacity === "1"', 12000, 'straight into the workspace');
  assert.equal(await p.has('.gate-progress'), false, 'the baseline must only ever be asked once');

  assert.deepEqual(p.errors, [], 'no uncaught page errors');
});

test('gate: the dial still moves everything, and users cannot see each other', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await p.waitFor('document.querySelector("#gate-form")', 10000, 'login form');
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  await pickPace(p, 'sprint');

  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.mode, 'sprint');
  assert.equal(me.profile.effective.maxApps, 4, 'the far end of the dial means several windows');
  assert.equal(me.profile.effective.checkinEvery, 'never');
  assert.equal(me.profile.effective.planPlace, 'window');

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
