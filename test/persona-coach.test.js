module.exports = (function () {
/* Skipped unless PERSONA=1. Real API calls: proves that telling Chameleon how
   you want it to behave, in the chat, actually changes it and keeps it changed. */
if (!process.env.PERSONA) {
  require('node:test')('coaching the UX from chat (set PERSONA=1 to run — real API calls)', { skip: true }, () => {});
  return;
}

const test = require('node:test');
const assert = require('node:assert');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

const idle = p => p.waitFor('!document.body.classList.contains("busy")', 300000, 'the agent to finish');

test('coaching: what you ask for in chat becomes a setting and stays one', { timeout: 900000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await p.waitFor('document.querySelector("#gate-form")', 20000);
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-progress")', 15000);
  /* start as the opposite of everything we are about to ask for, so any change
     is unambiguous rather than a lucky default */
  for (const a of ['all', 'rarely', 'window', 'chat', 'rich']) { await p.eval(`(() => { const d = document.getElementById('pace');
        d.value = ${LEVELS.indexOf(a)}; d.dispatchEvent(new Event('input')); })()`, false);
    await p.click('.gate-go'); await sleep(340); }
  await p.waitFor('!document.getElementById("gate")', 20000);
  await p.waitFor('window.__cham && window.__cham.sessionId()', 12000);

  const prof = () => p.eval('fetch("api/me").then(r=>r.json()).then(j=>j.profile.effective)');
  const say = async text => {
    await p.fill('#chat-input', text);
    await p.key('Enter');
    await p.waitFor('document.body.classList.contains("busy")', 25000, 'turn to start');
    await idle(p);
    await sleep(2500);
    return prof();
  };

  const start = await prof();
  assert.equal(start.maxApps, 4);
  assert.equal(start.planPlace, 'window');

  await say('Teach me how compound interest works');

  const one = await say('Stop opening more than one thing at a time — it is too much, I can only focus on one window');
  assert.equal(one.maxApps, 1, 'asking for one window at a time must become the budget');

  const moved = await say('Also put the plan in the chat rather than its own window, and check with me before each step');
  assert.equal(moved.planPlace, 'chat', 'the plan must move where they asked');
  assert.equal(moved.checkinEvery, 'step');
  assert.ok(await p.has('.cp-now'), 'and the spine must actually be in the chat now');
  assert.ok(!(await p.eval('window.__cham.open()')).includes('plan'), 'with no plan window left behind');

  const noPod = await say('And I never want podcasts, ever');
  assert.ok(!noPod.allowedApps.includes('podcast'), 'a window they rule out must leave the allowed set');

  /* it is a profile, not a memory of this conversation */
  await p.goto(app.url + '/');
  await p.waitFor('window.__cham && window.__cham.profile()', 15000, 'reload');
  const after = await p.eval('window.__cham.profile()');
  assert.equal(after.maxApps, 1);
  assert.equal(after.planPlace, 'chat');
  assert.ok(!after.allowedApps.includes('podcast'));

  /* and what they said shows up where they would go to change it by hand */
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 8000);
  assert.ok(await p.has('.up-row[data-k="planPlace"] button[data-v="chat"].on'));
  assert.ok(await p.has('.up-row[data-k="parallelism"] button[data-v="1"].on'));
  assert.ok(!(await p.eval('document.querySelector(String.raw`.up-app[data-app="podcast"]`).classList.contains("on")', false)));

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
})();
