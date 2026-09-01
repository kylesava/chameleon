/* Generated illustrations in a lesson.
   The failure this pins: a lesson tile repaints on narration, status changes
   and resizes, replacing every node in it. When a request was tied to the node
   that started it, each repaint orphaned the in-flight call and began another,
   and the "drawing…" spinner in front of the learner never resolved. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');

async function signIn(p) {
  await p.waitFor('document.querySelector("#gate-form")', 15000, 'login');
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  await pickPace(p, PACE[3]);
  await p.waitFor('!document.getElementById("gate")', 15000, 'gate');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 12000, 'boot');
}

/* Stub the image endpoint so this test never spends money or waits on a model,
   and so we can count exactly how many requests a repaint costs. */
const STUB = `(() => {
  window.__imgCalls = [];
  const real = window.fetch;
  window.fetch = (url, opts) => {
    if (String(url).endsWith('api/image')) {
      window.__imgCalls.push(JSON.parse(opts.body).prompt);
      return new Promise(res => setTimeout(() => res({
        ok: true, json: async () => ({ url: 'chameleon.png' }),
      }), 400));
    }
    return real(url, opts);
  };
})()`;

test('illustrations: a repaint mid-flight must not strand the spinner', { timeout: 150000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(STUB, false);

  /* a lesson with two illustrations, rendered the way the app renders one */
  await p.eval(`(() => {
    const el = document.createElement('div');
    el.id = 'imgtest';
    document.body.appendChild(el);
    window.__paint = () => {
      el.innerHTML = Rich.md('Intro paragraph.\\n\\n![a lit doorway](gen:a single lit doorway at the end of a dark corridor)\\n\\nMore words.\\n\\n![a river](gen:a river splitting into two streams)');
      Rich.enhance(el);
    };
    window.__paint();
  })()`, false);

  await p.waitFor('document.querySelectorAll("#imgtest .genimg").length === 2', 6000, 'two placeholders');

  /* repaint repeatedly while the requests are still in flight — this is what
     narration arriving during a lesson does */
  for (let i = 0; i < 5; i++) { await p.eval('window.__paint()', false); await sleep(90); }

  await p.waitFor('document.querySelectorAll("#imgtest .genimg.ready").length === 2', 15000,
    'both illustrations to land despite the repaints');

  const calls = await p.eval('window.__imgCalls');
  assert.equal(calls.length, 2,
    `each illustration should be asked for once, not once per repaint (got ${calls.length}: ${JSON.stringify(calls)})`);
  assert.equal(await p.count('#imgtest .genimg-wait'), 0, 'no spinner may be left behind');
  await p.shot(SHOTS + '/images-repaint.png');

  /* a fresh render of the same lesson paints from cache without asking again */
  await p.eval('window.__paint()', false);
  await p.waitFor('document.querySelectorAll("#imgtest .genimg.ready").length === 2', 8000, 'repaint from cache');
  assert.equal((await p.eval('window.__imgCalls')).length, 2, 'a later repaint must not re-request');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('illustrations: a failure says so rather than spinning forever', { timeout: 120000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(`(() => {
    const real = window.fetch;
    window.fetch = (url, opts) => String(url).endsWith('api/image')
      ? Promise.resolve({ ok: false, json: async () => ({ error: 'no credit' }) })
      : real(url, opts);
  })()`, false);

  await p.eval(`(() => {
    const el = document.createElement('div');
    el.id = 'imgtest';
    document.body.appendChild(el);
    el.innerHTML = Rich.md('![x](gen:something that cannot be drawn)');
    Rich.enhance(el);
  })()`, false);

  await p.waitFor('document.querySelector("#imgtest .genimg-failed")', 10000,
    'a failed illustration must say so, not spin');
  assert.match(await p.text('#imgtest .genimg'), /unavailable/i);

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
