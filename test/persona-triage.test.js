module.exports = (function () {
/* Skipped unless PERSONA=1. Real API calls.
   Matt: "it doesn't need to make a plan for every question I ask… there should
   be some kind of very quick decision upfront as to whether or not we need to
   apply a plan to a request versus just respond to the question."
   This is that decision, measured, in the two modes that pull hardest in
   opposite directions. */
if (!process.env.PERSONA) {
  require('node:test')('answer-or-plan triage (set PERSONA=1 to run — real API calls)', { skip: true }, () => {});
  return;
}

const test = require('node:test');
const assert = require('node:assert');
const { open, serve, sleep } = require('./drive.js');

const idle = p => p.waitFor('!document.body.classList.contains("busy")', 300000, 'the agent to finish');

const ASKS = [
  { t: 'Write me a short email declining a meeting next Tuesday', plan: false },
  { t: 'What is the difference between a stock and a bond?', plan: false },
  { t: 'I want to properly learn how transformers work over the next few weeks', plan: true },
  { t: 'Help me prepare for a driving theory test', plan: true },
];

for (const mode of ['simple', 'extreme']) {
  test(`triage: small asks are answered, big ones are planned (${mode})`, { timeout: 900000 }, async t => {
    const app = await serve();
    const br = await open({ headless: true });
    const p = await br.page(app.url + '/');
    t.after(async () => { await br.close(); await app.close(); });

    await p.waitFor('document.querySelector("#gate-form")', 20000, 'login');
    await p.fill('#gate-user', 'kyle');
    await p.fill('#gate-pass', 'YoungGuy');
    await p.click('#gate-form button');
    await p.waitFor('document.querySelector(".gate-options")', 15000, 'the one question');
    await p.click(`.gate-opt[data-v="${mode}"]`);
    await p.waitFor('!document.getElementById("gate")', 15000, 'gate');
    await p.waitFor('window.__cham && window.__cham.sessionId()', 12000, 'boot');

    for (const ask of ASKS) {
      /* a fresh journey each time, so one answer cannot contaminate the next */
      const r = await p.eval(`fetch('api/session', { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ title: 'probe' }) }).then(x => x.json())`);
      await p.goto(app.url + `/?session=${r.session.id}`);
      await p.waitFor('window.__cham && window.__cham.sessionId()', 15000, 'journey');

      await p.fill('#chat-input', ask.t);
      await p.key('Enter');
      await p.waitFor('document.body.classList.contains("busy")', 25000, 'turn to start');
      await idle(p);
      await sleep(1800);

      const plan = await p.eval('window.__cham.plan()');
      const planned = !!(plan && plan.tasks && plan.tasks.length);
      assert.equal(planned, ask.plan,
        `"${ask.t}" should have been ${ask.plan ? 'planned' : 'answered outright'} — got ${planned ? plan.tasks.length + ' steps' : 'no plan'}`);

      if (!ask.plan) {
        const reply = (await p.text('#chat-log')).replace(/\s+/g, ' ').trim();
        assert.ok(reply.length > 120,
          `an answered request must contain the answer itself in chat, not a pointer to a window (got ${reply.length} chars)`);
      }
    }

    assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
  });
}
})();
