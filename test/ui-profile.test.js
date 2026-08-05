/* The settings panel: the baseline is asked once, so this is where it has to
   stay changeable — and where the system says what it has concluded. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');

async function signIn(p, username, password, answers) {
  await p.waitFor('document.querySelector("#gate-form")', 12000, 'login form');
  await p.fill('#gate-user', username);
  await p.fill('#gate-pass', password);
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-progress")', 12000, 'baseline');
  const at = () => p.eval('[...document.querySelectorAll(".gate-progress i")].findIndex(i => i.classList.contains("on"))', false);
  for (const a of answers) {
    const was = await at();
    await p.click(`.gate-opt[data-v="${a}"]`);
    await sleep(300);
    if (await at() === was) { await p.click('.gate-next'); await sleep(300); }
  }
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 10000, 'session');
}

test('settings: what the baseline set is visible and changeable afterwards', { timeout: 150000 }, async t => {
  const app = await serve({ port: 8905 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p, 'matt', 'OldGuy', ['one', 'every-step', 'window', 'windows', 'plain']);

  /* the panel opens and shows what the baseline concluded */
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 6000, 'settings panel');
  assert.match(await p.text('.up-head b'), /Matt/);
  assert.ok(await p.has('.up-row[data-k="parallelism"] button[data-v="1"].on'),
    'the panel must show the one-window setting the baseline derived');
  assert.ok(await p.has('.up-row[data-k="checkins"] button[data-v="every-step"].on'));
  assert.ok(await p.has('.up-row[data-k="planPlace"] button[data-v="window"].on'),
    'where the plan lives is a baseline answer, not a hidden default');
  assert.ok(await p.has('.up-row[data-k="voice"] button[data-v="windows"].on'));
  await p.shot(SHOTS + '/settings-matt.png');

  /* changing one takes effect on the server, not just in the panel */
  await p.click('.up-row[data-k="parallelism"] button[data-v="3"]');
  await p.waitFor('document.querySelector(\'.up-row[data-k="parallelism"] button[data-v="3"].on\')', 6000, 'the change to stick');
  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.stated.parallelism, 3, 'the change must reach the stored profile');
  assert.equal(me.profile.effective.maxApps, 3, 'and flow through to the budget the agent is held to');
  assert.equal(me.profile.stated.planPlace, 'window', 'changing one setting must not reset the others');

  /* it survives a reload */
  await p.goto(app.url + '/');
  await p.waitFor('window.__cham && window.__cham.profile()', 12000, 'boot');
  assert.equal(await p.eval('window.__cham.profile().maxApps', false), 3);
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 6000);
  assert.ok(await p.has('.up-row[data-k="parallelism"] button[data-v="3"].on'));

  /* the panel closes on an outside click and does not cover the workspace */
  await p.eval('document.getElementById("stage").click()', false);
  await sleep(300);
  assert.equal(await p.has('body.settings-open'), false, 'clicking away must close it');

  /* signing out really signs you out */
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 6000);
  await p.click('.up-out');
  await p.waitFor('document.querySelector("#gate-form")', 15000, 'back at the sign-in screen');
  assert.equal(await p.eval('fetch("api/state").then(r => r.status)'), 401);

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('settings: behaviour the system has learned is shown back to the learner', { timeout: 150000 }, async t => {
  const app = await serve({ port: 8906 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p, 'kyle', 'YoungGuy', ['all', 'rarely', 'chat', 'chat', 'rich']);
  const sid = await p.eval('window.__cham.sessionId()');

  /* enough evidence for the system to have an opinion */
  await p.eval(`(async () => {
    for (let i = 0; i < 14; i++) await fetch('api/signal', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ session_id: ${sid}, kind: 'step_completed' }) });
    for (let i = 0; i < 4; i++) await fetch('api/signal', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ session_id: ${sid}, kind: 'slow_down' }) });
    for (let i = 0; i < 3; i++) await fetch('api/signal', { method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ session_id: ${sid}, kind: 'app_used', detail: 'quiz' }) });
  })()`);

  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('window.__cham && window.__cham.profile()', 12000, 'boot');
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 6000);
  assert.ok(await p.has('.up-learned'), 'once it has watched enough, it should say so');
  assert.match(await p.text('.up-learned'), /14 steps watched/i);
  assert.match(await p.text('.up-learned'), /you reach for quiz/i,
    'the window they actually use must be named, not reported as a number');
  await p.shot(SHOTS + '/settings-learned.png');

  /* repeatedly asking to slow down must actually change the experience */
  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.checkinEvery, 'step',
    'someone who keeps saying "slow down" should get check-ins back, whatever they first ticked');
  assert.equal(me.profile.stated.checkins, 'rarely',
    'and what they originally said must not be overwritten — it is evidence, not a mistake');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('settings: every knob is here, and switching a window off actually removes it', { timeout: 150000 }, async t => {
  const app = await serve({ port: 8908 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p, 'kyle', 'YoungGuy', ['two', 'every-stage', 'window', 'windows', 'diagrams']);
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 6000, 'settings panel');

  /* everything that changes behaviour is reachable from one place */
  for (const key of ['parallelism', 'checkins', 'planPlace', 'voice', 'chatter', 'depth', 'visuals', 'priorKnowledge']) {
    assert.ok(await p.has(`.up-row[data-k="${key}"]`), `no control for ${key}`);
  }
  assert.equal(await p.count('.up-app'), 5, 'every buildable window should be switchable');
  await p.shot(SHOTS + '/settings-full.png');

  /* nothing in the panel is stranded below the fold */
  const box = await p.box('#user-pop');
  assert.ok(box.bottom <= 900 + 1, `the panel runs off the bottom of the screen (${Math.round(box.bottom)})`);
  for (const sel of ['.up-retake', '.up-out']) {
    const t2 = await p.topAt(sel);
    assert.ok(t2 && !t2.covered, `${sel} is covered by ${t2 && (t2.id || t2.cls)}`);
  }

  /* where it talks is a real setting, not a style note */
  await p.click('.up-row[data-k="voice"] button[data-v="chat"]');
  await p.waitFor('document.querySelector(\'.up-row[data-k="voice"] button[data-v="chat"].on\')', 6000, 'voice to change');
  let me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.voice, 'chat');

  /* switching a window off removes it from what the agent may build */
  await p.click('.up-app[data-app="podcast"]');
  await p.waitFor('!document.querySelector(\'.up-app[data-app="podcast"]\').classList.contains("on")', 6000, 'podcast to switch off');
  me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.ok(!me.profile.effective.allowedApps.includes('podcast'), 'a switched-off window must leave the allowed set');
  assert.ok(me.profile.effective.allowedApps.includes('lesson'), 'and the others must be untouched');

  /* it must not be possible to switch everything off */
  for (const a of ['lesson', 'quiz', 'flashcards', 'deck']) {
    await p.click(`.up-app[data-app="${a}"]`);
    await sleep(250);
  }
  me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.ok(me.profile.effective.allowedApps.length >= 1, 'the last window must not be switchable off');

  /* and the baseline can be taken again */
  await p.click('.up-retake');
  await p.waitFor('document.querySelector(".gate-progress")', 15000, 'the baseline to come back');
  assert.equal(await p.count('.gate-progress i'), 5);

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
