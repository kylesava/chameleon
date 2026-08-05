/* The plan window, driven in a real browser against a seeded plan.
   No agent calls — this is about whether the spine is unambiguous and whether
   every control on it actually works. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');

/* Sign in and drop a three-step plan straight into the database via the same
   tool the agent would use, then reload so the UI renders it cold. */
async function seeded(p, url, username, password, answers) {
  await p.waitFor('document.querySelector("#gate-form")', 12000, 'login form');
  await p.fill('#gate-user', username);
  await p.fill('#gate-pass', password);
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-progress")', 12000, 'baseline');
  for (const a of answers) {
    const at = () => p.eval('[...document.querySelectorAll(".gate-progress i")].findIndex(i => i.classList.contains("on"))', false);
    const was = await at();
    await p.click(`.gate-opt[data-v="${a}"]`);
    await sleep(300);
    // multi-select answers toggle rather than advance, so nudge those along
    if (await at() === was) { await p.click('.gate-next'); await sleep(300); }
  }
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 10000, 'session');
  return p.eval('window.__cham.sessionId()');
}

const PLAN = {
  title: 'Understand compound interest',
  tasks: [
    { title: 'See what compounding actually does', detail: 'Read the worked example of £1,000 at 5% over 30 years.', done_when: 'You can say why year 30 adds more than year 1', apps: ['lesson'] },
    { title: 'Do the arithmetic yourself', detail: 'Work three examples without the formula sheet.', done_when: 'You get all three within £5', apps: ['quiz'] },
    { title: 'Apply it to your own savings', detail: 'Put your real numbers in and read the curve.', done_when: 'You have a figure for your own 10-year total', apps: ['lesson', 'quiz'] },
  ],
};

test('plan: the current step is unambiguous and every control works', { timeout: 180000 }, async t => {
  const app = await serve({ port: 8903 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  const sid = await seeded(p, app.url, 'matt', 'OldGuy', ['one', 'every-step', 'window', 'windows', 'diagrams']);
  await p.eval(`fetch('api/test/plan', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, ...${JSON.stringify(PLAN)} }) }).then(r => r.json())`);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000, 'the current-step card');

  /* ---- the card answers "what am I doing / how do I know I am done" ---- */
  assert.match(await p.text('.pn-top em'), /step 1 of 3/i);
  assert.match(await p.text('.plan-now > b'), /compounding actually does/i);
  assert.match(await p.text('.pn-do'), /worked example/i);
  assert.match(await p.text('.pn-done'), /why year 30 adds more/i,
    'the card must say what finished looks like — this is the part that was guesswork');
  assert.equal(await p.count('.pn-apps i'), 1, 'the step should show which window it needs');
  await p.shot(SHOTS + '/plan-step.png');

  /* ---- nothing covers the buttons ---- */
  for (const sel of ['.pn-go', '.pn-stuck', '.plan-add']) {
    const top = await p.topAt(sel);
    assert.ok(top && !top.covered, `${sel} is covered by ${top && (top.id || top.cls)}`);
  }

  /* ---- exactly one step is live, always ---- */
  assert.equal(await p.count('.plan-task.doing'), 1, 'exactly one live step');

  /* ---- Continue advances the spine ---- */
  await p.click('.pn-go');
  await p.waitFor('document.querySelector(".pn-top em") && /step 2 of 3/i.test(document.querySelector(".pn-top em").innerText)',
    12000, 'the plan to advance to step 2');
  assert.equal(await p.count('.plan-task.done'), 1, 'the finished step should be ticked');
  assert.equal(await p.count('.plan-task.doing'), 1, 'still exactly one live step');
  assert.match(await p.text('.pn-done'), /within £5/, 'the new step brings its own done-when');

  /* the advance is recorded as a signal, not just a UI change */
  const prof = await p.eval('fetch("api/me").then(r => r.json())');
  assert.ok(prof.profile.effective, 'profile still resolves after advancing');

  /* ---- I'm stuck does not advance ---- */
  await p.click('.pn-stuck');
  await sleep(900);
  assert.match(await p.text('.pn-top em'), /step 2 of 3/i, '"I\'m stuck" must never move the plan on');

  /* ---- jumping to a step from the trail ---- */
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000);
  const third = await p.eval('document.querySelectorAll(".plan-task")[2].dataset.t', false);
  await p.eval(`document.querySelector('.plan-task[data-t="${third}"] .pt-start').click()`, false);
  await p.waitFor('/step 3 of 3/i.test(document.querySelector(".pn-top em").innerText)', 12000, 'jump to step 3');

  /* ---- the last step reads as the last step ---- */
  assert.match(await p.text('.pn-go'), /finish/i, 'the final step should not promise a next one');
  await p.shot(SHOTS + '/plan-last.png');

  /* ---- editing and removing still work ---- */
  const before = await p.count('.plan-task');
  await p.eval(`(() => { const r = document.querySelectorAll('.plan-task')[0];
    r.querySelector('.pt-del').click(); })()`, false);
  await p.waitFor(`document.querySelectorAll('.plan-task').length === ${before - 1}`, 8000, 'the step to be removed');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('plan: an empty plan and a finished plan both read sensibly', { timeout: 120000 }, async t => {
  const app = await serve({ port: 8904 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  const sid = await seeded(p, app.url, 'kyle', 'YoungGuy', ['all', 'rarely', 'window', 'chat', 'rich']);

  /* one step, complete it, and the card must not claim there is a next one */
  await p.eval(`fetch('api/test/plan', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, title: 'One thing',
      tasks: [{ title: 'The only step', detail: 'do it', done_when: 'it is done' }] }) }).then(r => r.json())`);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000);
  assert.match(await p.text('.pn-go'), /finish/i);

  await p.click('.pn-go');
  await p.waitFor('document.querySelector(".plan-now.idle")', 12000, 'the finished state');
  assert.match(await p.text('.plan-now'), /All steps done/i);
  assert.equal(await p.count('.pn-go'), 0, 'nothing to continue to');
  assert.match(await p.text('.plan-title span'), /1 of 1/);
  await p.shot(SHOTS + '/plan-done.png');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('plan: the ready button comes back to life when the agent stops working', { timeout: 120000 }, async t => {
  const app = await serve({ port: 8907 });
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  const sid = await seeded(p, app.url, 'matt', 'OldGuy', ['one', 'every-step', 'window', 'windows', 'diagrams']);
  await p.eval(`fetch('api/test/plan', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, ...${JSON.stringify(PLAN)} }) }).then(r => r.json())`);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".pn-go")', 15000, 'the step card');
  assert.equal(await p.eval('document.querySelector(".pn-go").disabled', false), false);

  /* While a turn runs the button is deliberately dead — one advance at a time. */
  await p.eval(`(() => { document.body.classList.add('busy'); window.__cham.repaintPlan(); })()`, false);
  await p.waitFor('document.querySelector(".pn-go").disabled', 6000, 'the button to disable while busy');

  /* And it must wake up again when the turn ends, without the learner having to
     touch anything — this is the button the whole pacing model rests on. */
  await p.eval(`(() => { document.body.classList.remove('busy'); window.__cham.endTurn(); })()`, false);
  await p.waitFor('!document.querySelector(".pn-go").disabled', 8000, 'the button to come back');
  await p.click('.pn-go');
  await p.waitFor('/step 2 of 3/i.test(document.querySelector(".pn-top em").innerText)', 12000,
    'the plan to advance after the turn settled');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
