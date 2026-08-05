/* The plan living in the conversation — Matt's version of the spine.
   No plan window at all: the current step sits at the top of the chat surface,
   the steps are clickable, and Ready/I'm stuck are next to the composer. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');

const PLAN = {
  title: 'Understand compound interest',
  tasks: [
    { title: 'See what compounding actually does', detail: 'Read the worked example.', done_when: 'You can say why year 30 adds more than year 1', apps: ['lesson'] },
    { title: 'Do the arithmetic yourself', detail: 'Work three examples.', done_when: 'You get all three within £5', apps: ['quiz'] },
    { title: 'Apply it to your own savings', detail: 'Real numbers.', done_when: 'You have a 10-year total', apps: ['lesson'] },
  ],
};

async function asMatt(p, url, mode) {
  await p.waitFor('document.querySelector("#gate-form")', 15000, 'login');
  await p.fill('#gate-user', 'matt');
  await p.fill('#gate-pass', 'OldGuy');
  await p.click('#gate-form button');
  await pickPace(p, mode);
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 12000, 'boot');
  const sid = await p.eval('window.__cham.sessionId()');
  await p.eval(`fetch('api/test/plan', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, ...${JSON.stringify(PLAN)} }) }).then(r => r.json())`);
  await p.goto(url + `/?session=${sid}`);
  return sid;
}

test('chat spine: the plan is in the conversation and there is no plan window', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  const sid = await asMatt(p, app.url, 'slow-walk');
  await p.waitFor('document.querySelector(".cp-now")', 15000, 'the spine in the chat');

  /* the setting Matt actually asked for */
  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.planPlace, 'chat');
  assert.equal(me.profile.effective.maxApps, 1, 'one thing at a time');
  assert.equal(me.profile.effective.checkinEvery, 'step');

  /* no plan window, anywhere */
  assert.deepEqual(await p.eval('window.__cham.open()'), [], 'nothing should be open — the spine is in the chat');
  assert.equal(await p.has('.plan-now'), false, 'the plan tile must not render');

  /* the current step reads the same as it would in a window */
  assert.match(await p.text('.cp-now em'), /step 1 of 3/i);
  assert.match(await p.text('.cp-now b'), /compounding actually does/i);
  assert.match(await p.text('.cp-done'), /why year 30 adds more/i);
  await p.shot(SHOTS + '/chatplan-step.png');

  /* and nothing covers the controls */
  for (const sel of ['.cp-go', '.cp-stuck', '#chat-input']) {
    const top = await p.topAt(sel);
    assert.ok(top && !top.covered, `${sel} is covered by ${top && (top.id || top.cls)}`);
  }

  /* the spine makes the chat card much taller — the canvas has to give way,
     folded or expanded, or the lesson is unreadable underneath it */
  await p.click('#apps-btn');
  await sleep(350);
  await p.click('.ap-row[data-id="lesson"]');
  await sleep(800);
  assert.equal(await p.count('.tile'), 1, 'a window to test the overlap against');
  assert.deepEqual(await p.coveredTiles(), [], 'the chat card must not sit on top of an app window');
  await p.click('.cp-head');
  await sleep(700);
  assert.deepEqual(await p.coveredTiles(), [], 'nor when the step list is expanded');
  await p.click('.cp-head');
  await sleep(500);

  /* the whole plan is one click away, and steps are clickable triggers */
  /* open it explicitly rather than toggling — the earlier overlap checks
     already opened and closed it, and a blind toggle depends on that history */
  if (await p.eval('document.querySelector(".cp-list").hidden', false)) await p.click('.cp-head');
  await p.waitFor('!document.querySelector(".cp-list").hidden', 8000, 'the step list to open');
  assert.equal(await p.count('.cp-step'), 3);
  assert.equal(await p.count('.cp-step.doing'), 1, 'exactly one live step');

  /* clicking a step jumps to it — Matt's "clicking on the plan items as a trigger" */
  const third = await p.eval('document.querySelectorAll(".cp-step")[2].dataset.t', false);
  await p.click(`.cp-step[data-t="${third}"]`);
  await p.waitFor('/step 3 of 3/i.test(document.querySelector(".cp-now em").innerText)', 12000, 'jump to step 3');
  assert.match(await p.text('.cp-go'), /finish/i, 'the last step should not promise a next one');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('chat spine: Ready advances, I am stuck does not', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await asMatt(p, app.url, 'slow-walk');
  await p.waitFor('document.querySelector(".cp-go")', 15000, 'the ready button');

  await p.click('.cp-go');
  await p.waitFor('/step 2 of 3/i.test(document.querySelector(".cp-now em").innerText)', 12000, 'advance to step 2');
  await p.click('.cp-head');
  await p.waitFor('!document.querySelector(".cp-list").hidden', 6000);
  assert.equal(await p.count('.cp-step.done'), 1, 'the finished step is ticked in the trail');
  assert.equal(await p.count('.cp-step.doing'), 1);
  assert.match(await p.text('.cp-done'), /within £5/, 'the new step brings its own finish line');
  await p.shot(SHOTS + '/chatplan-advanced.png');

  await p.click('.cp-stuck');
  await sleep(1000);
  assert.match(await p.text('.cp-now em'), /step 2 of 3/i, '"I\'m stuck" must never move the plan on');

  /* the spine survives the transcript being tucked away — it is structure */
  await p.eval('document.body.classList.add("acting")', false);
  await sleep(300);
  assert.equal(await p.eval('getComputedStyle(document.getElementById("chat-plan")).display', false), 'block',
    'the spine must stay visible while the agent works');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('chat spine: switching where the plan lives moves it, both ways', { timeout: 180000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  /* start in a window, like Kyle */
  await asMatt(p, app.url, 'sprint');
  await p.waitFor('document.querySelector(".plan-now")', 15000, 'the plan window');
  assert.ok((await p.eval('window.__cham.open()')).includes('plan'));
  assert.equal(await p.has('.cp-now'), false, 'not in the chat as well — one home, not two');

  /* the primary path: one mode card moves everything, including the plan */
  await p.click('#user-btn');
  await p.waitFor('document.querySelector("body.settings-open")', 8000, 'settings');
  assert.ok(await p.has('#pace'), 'one dial, and nothing else up front');
  assert.equal(await p.eval('document.querySelector(".up-advbody").hidden', false), true,
    'the individual settings start folded away');
  await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 0; d.dispatchEvent(new Event('input')); d.dispatchEvent(new Event('change')); })()`, false);
  await p.waitFor('document.querySelector(".cp-now")', 10000, 'the spine to move into the chat');
  assert.ok(!(await p.eval('window.__cham.open()')).includes('plan'), 'the window should have closed itself');
  // the tile animates out, so give it its exit before declaring it gone
  await p.waitFor('!document.querySelector(".plan-now")', 6000, 'the plan window to leave');

  /* and back again, this time through Advanced — the detail is still reachable */
  await p.click('.up-adv');
  await p.waitFor('!document.querySelector(".up-advbody").hidden', 6000, 'advanced to open');
  await p.click('.up-row[data-k="planPlace"] button[data-v="window"]');
  await p.waitFor('document.querySelector(".plan-now")', 10000, 'the spine to move back to a window');
  assert.equal(await p.eval('getComputedStyle(document.getElementById("chat-plan")).display', false), 'none');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
