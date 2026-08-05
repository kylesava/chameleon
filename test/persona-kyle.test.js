module.exports = (function () {
/* Skipped unless PERSONA=1. These drive whole journeys against the live
   Anthropic API — several minutes and real money per run — so they must never
   fire as a side effect of the documented `node --test "test/*.test.js"`. */
if (!process.env.PERSONA) {
  require('node:test')('persona journeys (set PERSONA=1 to run — real API calls)', { skip: true }, () => {});
  return;
}

/* Kyle's journey, driven end to end in a real browser against the real agent.
   =========================================================================
   Kyle is the impatient power user: "firehose", never check in, concise, and
   he wants several things on screen. His baseline derives maxApps 4 /
   checkinEvery 'never' / depth 'concise'.

   This makes REAL Anthropic calls, so it is slow (5-10 minutes) and the exact
   content differs every run. Everything asserted here is therefore a property
   that must hold for ANY sane turn — never a specific sentence.

   Run it on its own:   node --test test/persona-kyle.test.js

   Structure: one journey, many subtests. A failing subtest does not abort the
   parent, so one broken thing never hides the state of everything after it.

   NOTE ON WAITING. `document.body.classList.contains('busy')` is NOT a
   trustworthy "the agent has finished" signal — that is one of the bugs this
   file pins down. So the helpers below watch the /api/chat SSE stream itself
   (wrapped in the page) and only then wait for the client to settle.
*/
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');
const PORT = 8941;
/* drive.open() derives its debug port from the pid, so two browsers in one
   process would collide — every one of them gets an explicit port. */
const CDP = 9701, CDP_SMALL = 9702, CDP_BIG = 9703;

const GOAL = 'Teach me how transformers work — I already know linear algebra and Python';
const PUSH = 'Quiz me on that now — multiple choice — and build me a flashcard deck for the shapes. Keep going, do not wait for me.';

/* ------------------------------------------------------------------ *
 * page instrumentation
 * ------------------------------------------------------------------ */

/* Ground truth for "is the agent still talking". The SSE response body is
   swapped for an identical stream that tells us when it ends — the Response
   object itself is untouched, so the app cannot tell the difference. This is
   deliberately independent of body.busy, which is the thing under test. */
const STREAMWATCH = `(() => {
  window.__stream = { open: 0, done: 0, lastEnd: 0 };
  const orig = window.fetch;
  window.fetch = async (...a) => {
    const res = await orig(...a);
    try {
      if (!/event-stream/.test(res.headers.get('content-type') || '') || !res.body) return res;
      const rdr = res.body.getReader();
      let closed = false;
      const mark = () => { if (closed) return; closed = true;
        window.__stream.open--; window.__stream.done++; window.__stream.lastEnd = Date.now(); };
      window.__stream.open++;
      const wrapped = new ReadableStream({
        async pull(c) {
          try { const { done, value } = await rdr.read();
            if (done) { mark(); c.close(); } else c.enqueue(value); }
          catch (e) { mark(); c.error(e); }
        },
        cancel(r) { mark(); try { rdr.cancel(r); } catch {} },
      });
      Object.defineProperty(res, 'body', { value: wrapped, configurable: true });
    } catch (e) { window.__stream.err = String(e); }
    return res;
  };
  return true;
})()`;

/* A 400ms sample of the workspace + every transition of body.busy/.acting.
   Sampling from the driver would miss states hidden behind CDP latency, and
   the whole point of the budget check is that a transient 5th window counts. */
const RECORDER = `(() => {
  window.__rec = { t0: Date.now(), samples: [], flips: [] };
  const flip = () => window.__rec.flips.push({
    ms: Date.now() - window.__rec.t0,
    busy: document.body.classList.contains('busy'),
    acting: document.body.classList.contains('acting'),
    stream: window.__stream.open,
  });
  flip();
  new MutationObserver(flip).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  clearInterval(window.__recT);
  window.__recT = setInterval(() => {
    try {
      const apps = (window.__cham ? window.__cham.open() : []).slice();
      const lens = [...document.querySelectorAll('.tile')].map(t =>
        ((t.querySelector('.tile-name') || {}).textContent || '?') + ':' +
        (((t.querySelector('.tile-body') || {}).innerText) || '').length);
      window.__rec.samples.push({
        ms: Date.now() - window.__rec.t0,
        busy: document.body.classList.contains('busy'),
        acting: document.body.classList.contains('acting'),
        stream: window.__stream.open,
        apps, lens,
        msgs: document.querySelectorAll('#chat-log .msg').length,
        key: apps.join('+') + '|' + lens.join(',') + '|' + document.querySelectorAll('#chat-log .msg').length,
      });
    } catch {}
  }, 400);
  return true;
})()`;

const readRec = p => p.eval('JSON.stringify(window.__rec.samples)', false).then(JSON.parse);
const mark = p => p.eval('window.__rec.samples.length', false);

const streamDone = p => p.eval('window.__stream.done', false);

/* Wait for the agent to be genuinely finished: the SSE stream we are watching
   has closed, and then the client's action queue has been quiet for a beat.
   `since` is the value of __stream.done taken before the turn was triggered. */
async function settle(p, since, { quiet = 5000, cap = 300000, label = 'the turn', require: needed = true } = {}) {
  const t0 = Date.now();
  try {
    await p.waitFor(`window.__stream.open > 0 || window.__stream.done > ${since}`, needed ? 30000 : 8000,
      `${label} to reach the server`);
  } catch (e) {
    if (needed) throw e;
    return 0;
  }
  await p.waitFor(`window.__stream.open === 0 && window.__stream.done > ${since}`, cap, `${label} to finish streaming`);
  let lastKey = null, lastChange = Date.now();
  while (Date.now() - t0 < cap) {
    const [open, key] = await p.eval(`(() => { const s = window.__rec.samples[window.__rec.samples.length - 1] || {};
      return [window.__stream.open, s.key || '']; })()`, false);
    if (open > 0) lastChange = Date.now();
    if (key !== lastKey) { lastKey = key; lastChange = Date.now(); }
    if (Date.now() - lastChange > quiet) break;
    await sleep(500);
  }
  return Date.now() - t0;
}

/* Type a turn into the composer and let it run to completion. */
async function turn(p, text, opts = {}) {
  const from = await mark(p);
  const since = await streamDone(p);
  await p.fill('#chat-input', text);
  await p.key('Enter');
  const ms = await settle(p, since, opts);
  console.log(`    [kyle] turn finished after ${Math.round(ms / 1000)}s: ${text.slice(0, 48)}…`);
  return from;
}

/* ------------------------------------------------------------------ *
 * sign-in
 * ------------------------------------------------------------------ */

/* Kyle's baseline: firehose · rarely · concise · (practice + diagrams, which
   is multi-select and does NOT auto-advance) · strong. */
async function signIn(p, { baseline = true } = {}) {
  await p.waitFor('document.querySelector("#gate-form")', 25000, 'login form');
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  if (baseline) {
    await p.waitFor('document.querySelector(".gate-progress")', 25000, 'the baseline');
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
    await p.waitFor('document.querySelector(".gate-progress i:nth-child(2).on")', 8000, 'question 2');
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
    await p.waitFor('document.querySelector(".gate-progress i:nth-child(3).on")', 8000, 'question 3');
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
    await p.waitFor('document.querySelector(".gate-progress i:nth-child(4).on")', 8000, 'question 4');
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
    await sleep(150);
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
    await sleep(150);
    assert.equal(await p.count('.gate-opt.on'), 2, 'both modalities should stay lit');
    assert.ok(await p.has('.gate-progress i:nth-child(4).on'), 'multi-select must not auto-advance');
    await p.click('.gate-next');
    await p.waitFor('document.querySelector(".gate-progress i:nth-child(5).on")', 8000, 'question 5');
    await p.eval(`(() => { const d = document.getElementById('pace');
    d.value = 1; d.dispatchEvent(new Event('input')); })()`, false);
  await p.click('.gate-go');
  }
  await p.waitFor('!document.getElementById("gate")', 25000, 'gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 20000, 'session');
}

/* ------------------------------------------------------------------ *
 * geometry
 * ------------------------------------------------------------------ */
const RECTS = `(() => {
  const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
  const box = e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const tiles = [...document.querySelectorAll('.tile')]
    .filter(t => vis(t) && !t.classList.contains('exit') && !t.classList.contains('suppressed'))
    .map(t => ({ name: (t.querySelector('.tile-name') || {}).textContent || '?', ...box(t) }));
  const dockEl = document.getElementById('chatdock');
  const dock = dockEl && vis(dockEl) ? box(dockEl) : null;
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) *
                          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  const pairs = [];
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const o = inter(tiles[i], tiles[j]);
    if (o > 16) pairs.push({ a: tiles[i].name, b: tiles[j].name, overlap: Math.round(o) });
  }
  const covered = dock ? tiles.map(t => ({ name: t.name, pct: Math.round(100 * inter(t, dock) / Math.max(1, t.w * t.h)) })) : [];
  return { vw: innerWidth, vh: innerHeight, tiles, dock, pairs, covered };
})()`;
const geometry = p => p.eval(RECTS, false);

/* drive.js's overflowing() also flags anything whose bottom is far below the
   fold — which is just "this tile scrolls" — KaTeX's stretchy <path> elements
   report a 6000px-wide box, and a wide line inside a horizontally scrolling
   <pre> is exactly what that scrollbar is for. None of those is a layout bug.
   What IS one: content that escapes every clipping ancestor and lands off the
   side of the window. */
async function horizontalOverflow(p) {
  return p.eval(`(() => { const out = [];
    const clipped = e => {
      for (let a = e.parentElement; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
          const r = a.getBoundingClientRect();
          if (r.right <= innerWidth + 2 && r.left >= -2) return true;
        }
      }
      return false;
    };
    for (const e of document.querySelectorAll('body *')) {
      if (e.closest('.katex') || e.closest('svg')) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
      if ((r.right > innerWidth + 2 || r.left < -2) && !clipped(e))
        out.push({ sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
          (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : ''),
          left: Math.round(r.left), right: Math.round(r.right) });
    }
    return out.slice(0, 12); })()`, false);
}

/* Is this control actually operable — on screen, and with nothing on top of
   it? Scrolls it into view first, exactly as a person would. */
async function reachable(p, sel) {
  await p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
    if (e) e.scrollIntoView({ block: 'center' }); })()`, false);
  await sleep(250);
  return p.eval(`(() => {
    const e = document.querySelector(${JSON.stringify(sel)});
    if (!e) return { found: false };
    const r = e.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const onScreen = x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight;
    const top = onScreen ? document.elementFromPoint(x, y) : null;
    const dock = document.getElementById('chatdock');
    return {
      found: true, onScreen, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hit: top ? top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') : null,
      covered: !!(top && !e.contains(top) && top !== e),
      byChat: !!(top && dock && (dock === top || dock.contains(top))),
    };
  })()`, false);
}

const cleanErrors = p => p.errors.filter(e => !/favicon/i.test(e));
const tileText = p => p.eval(`JSON.stringify([...document.querySelectorAll('.tile')].map(t => ({
  name: (t.querySelector('.tile-name') || {}).textContent,
  drafting: !!t.querySelector('.draft-root'),
  text: ((t.querySelector('.tile-body') || {}).innerText || '') })))`, false).then(JSON.parse);

/* ------------------------------------------------------------------ *
 * the journey
 * ------------------------------------------------------------------ */
test('kyle: the impatient power user, end to end', { timeout: 1500000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900, port: CDP });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(STREAMWATCH, false);
  await p.eval(RECORDER, false);
  await p.shot(SHOTS + '/kyle-01-workspace.png');
  const sid = await p.eval('window.__cham.sessionId()', false);

  await t.test('baseline: Kyle\'s answers derive the firehose profile', async () => {
    const me = await p.eval('fetch("api/me").then(r => r.json())');
    assert.equal(me.user.username, 'kyle');
    assert.equal(me.profile.effective.maxApps, 4, 'firehose means a budget of four windows');
    assert.equal(me.profile.effective.checkinEvery, 'never', 'Kyle never wants to be asked');
    assert.equal(me.profile.effective.depth, 'concise');
  });

  /* ------------------- turn 1: a real learning request ------------------- */
  const from1 = await turn(p, GOAL);
  await p.shot(SHOTS + '/kyle-02-turn1.png');
  const rec1 = (await readRec(p)).slice(from1);

  await t.test('turn 1: a plan is built, and every step says when it is done', async () => {
    const plan = await p.eval('JSON.stringify(window.__cham.plan())', false).then(JSON.parse);
    assert.ok(plan && plan.tasks && plan.tasks.length >= 3, 'the spine must exist: ' + JSON.stringify(plan));
    const vague = plan.tasks.filter(s => !s.done_when || !String(s.done_when).trim());
    assert.deepEqual(vague.map(s => s.title), [],
      'every step needs a done_when — without one the learner is guessing');
    assert.ok(await p.has('.plan-now'), 'the live step must be on screen');
    assert.equal(await p.count('.plan-task.doing'), 1, 'exactly one step is live');
  });

  await t.test('turn 1: four windows is a ceiling, never exceeded', async () => {
    const worst = rec1.reduce((m, s) => {
      const n = s.apps.filter(a => a !== 'plan').length;
      return n > m.n ? { n, apps: s.apps.slice(), ms: s.ms } : m;
    }, { n: 0, apps: [], ms: 0 });
    console.log('    [kyle] peak non-plan windows in turn 1:', worst.n,
      '· sets seen:', [...new Set(rec1.map(s => s.apps.join('+')))].join(' | '));
    assert.ok(worst.n <= 4,
      `the agent had ${worst.n} non-plan windows open at once (${worst.apps.join(', ')})`);
  });

  await t.test('turn 1: momentum — real content lands, not a placeholder', async () => {
    const bodies = await tileText(p);
    const teaching = bodies.filter(b => /lesson|quiz|flashcards|deck|podcast/i.test(b.name));
    assert.ok(teaching.length >= 1,
      'Kyle is never to be asked permission, so turn 1 must put teaching material on screen, ' +
      'not just a plan. Windows open: ' + bodies.map(b => b.name).join(', '));
    assert.deepEqual(teaching.filter(b => b.drafting).map(b => b.name), [],
      'a window is still stuck mid-write after the turn finished');
    const substantive = teaching.filter(b => b.text.trim().length > 400);
    assert.ok(substantive.length >= 1,
      'the teaching window holds no real content: ' +
      JSON.stringify(teaching.map(b => [b.name, b.text.length, b.text.slice(0, 90)])));
    assert.ok(!teaching.some(b => /^No (lesson|quiz|deck|podcast) yet/.test(b.text.trim())),
      'a window was opened with an empty state in it');
  });

  await t.test('turn 1: the UI must not declare the turn over while the agent is still streaming', async () => {
    /* body.busy is three things at once: the spinner, the stop button, and
       "the history is hidden because I am working". If it clears early the
       learner is told the agent has finished when it has not — and can no
       longer interrupt what is still happening.

       This is a RACE, not a certainty: playQueue()'s finally block in
       main.js (~line 279) calls Chat.turnSettled() whenever the action queue
       happens to empty, with no check that the SSE stream is still open. It
       fires whenever the agent leaves a gap between events longer than the
       queue takes to drain — observed on 3 of 6 runs of this journey, the
       worst being "finished" at 17s against a stream that ran to 51s. */
    const lying = rec1.filter(s => s.stream > 0 && !s.busy);
    const firstIdle = rec1.find(s => !s.busy && s.ms > (rec1[0] || {}).ms);
    const lastStream = [...rec1].reverse().find(s => s.stream > 0);
    console.log('    [kyle] busy/acting/stream flips:',
      JSON.stringify((await p.eval('JSON.stringify(window.__rec.flips)', false).then(JSON.parse)).slice(0, 30)));
    if (firstIdle && lastStream) {
      console.log(`    [kyle] client said "finished" at ${Math.round(firstIdle.ms / 1000)}s; ` +
        `the agent stream ran to ${Math.round(lastStream.ms / 1000)}s`);
    }
    assert.equal(lying.length, 0,
      `for ${Math.round(lying.length * 0.4)}s the workspace said the turn was over while the agent ` +
      'was still streaming: the spinner stopped, the stop button turned back into send, and ' +
      'windows carried on opening with no way to interrupt them. ' +
      (lying.length ? `First at ${Math.round(lying[0].ms / 1000)}s, last at ${Math.round(lying[lying.length - 1].ms / 1000)}s.` : ''));
  });

  await t.test('turn 1: the composer never ends up stuck in the acting state', async () => {
    const now = await p.eval(`JSON.stringify({ busy: document.body.classList.contains('busy'),
      acting: document.body.classList.contains('acting'), stream: window.__stream.open })`, false).then(JSON.parse);
    assert.equal(now.acting, false,
      'body.acting is still set with nothing running — the chat history stays collapsed ' +
      'and the chat bar refuses to be dragged (chat.js line 81)');
    assert.equal(now.busy, false);
  });

  /* ------------------- the lesson: go deeper -------------------
     Done here, while the lesson from turn 1 is certainly the live window. */
  let sinceDeep = await streamDone(p);
  await t.test('lesson: clicking a section asks the agent to go deeper', async () => {
    assert.ok(await p.has('.lesson-sec h3'), 'turn 1 left no lesson with sections to click');
    const headed = await reachable(p, '.lesson-sec h3');
    assert.ok(!headed.covered,
      `the section heading is under ${headed.hit}${headed.byChat ? ' (the chat dock)' : ''} — ` +
      'clicking "go deeper" is impossible');
    const before = await p.eval('document.querySelectorAll("#chat-log .msg").length', false);
    sinceDeep = await streamDone(p);
    await p.click('.lesson-sec h3');
    await p.waitFor(`document.querySelectorAll("#chat-log .msg").length > ${before}`, 20000,
      'the section click to register as a turn');
    const chip = await p.text('#chat-log .msg:last-child');
    console.log('    [kyle] go-deeper chip:', JSON.stringify(chip));
    assert.ok(!/artifact|task|#\d+/i.test(chip),
      'internal ids must never reach the transcript, got: ' + chip);
  });
  await settle(p, sinceDeep, { label: 'the go-deeper turn', require: false });
  await p.shot(SHOTS + '/kyle-03-deeper.png');

  /* ------------------- turn 2: ask for the interactive apps ------------------- */
  const from2 = await turn(p, PUSH);
  await p.shot(SHOTS + '/kyle-04-turn2.png');
  const rec2 = (await readRec(p)).slice(from2);

  await t.test('turn 2: the budget still holds when Kyle asks for several things', async () => {
    const worst = rec2.reduce((m, s) => Math.max(m, s.apps.filter(a => a !== 'plan').length), 0);
    console.log('    [kyle] peak non-plan windows in turn 2:', worst,
      '· ended with:', await p.eval('JSON.stringify(window.__cham.open())', false));
    assert.ok(worst <= 4, `${worst} non-plan windows open at once — 4 is a hard ceiling`);
  });

  await t.test('turn 2: the UI must not declare this turn over early either', async () => {
    const lying = rec2.filter(s => s.stream > 0 && !s.busy);
    assert.equal(lying.length, 0,
      `the UI said turn 2 was finished for ${Math.round(lying.length * 0.4)}s while the agent ` +
      'was still streaming');
  });

  await t.test('turn 2: nothing is left half-written', async () => {
    const bodies = await tileText(p);
    assert.deepEqual(bodies.filter(b => b.drafting).map(b => b.name), [],
      'a tile is still showing the "writing…" placeholder after the turn ended: ' +
      JSON.stringify(bodies.map(b => [b.name, b.text.slice(0, 60)])));
  });

  const geo = await geometry(p);
  console.log('    [kyle] tile coverage by the chat dock:', JSON.stringify(geo.covered));

  await t.test('layout: tiles never overlap each other', async () => {
    assert.deepEqual(geo.pairs, [], 'two tiles are on top of each other');
  });

  await t.test('layout: the chat dock does not bury the workspace', async () => {
    assert.deepEqual(geo.covered.filter(c => c.pct > 25), [],
      'the fused chat card floats on top of the tiles and hides their content — ' +
      JSON.stringify(geo.covered) + '. Kyle asked for several things on screen and the ' +
      'transcript is sitting over them.');
  });

  /* ------------------- the quiz, end to end ------------------- */
  const hasQuiz = await p.has('.quiz .qq');

  await t.test('quiz: it is operable where the agent left it', async () => {
    assert.ok(hasQuiz, 'Kyle asked to be quizzed and no quiz was built');
    /* A control the learner cannot click is not a control. Scroll each one
       into view first, exactly as a person would, then look at what is
       actually on top of it. */
    const blocked = [];
    const n = await p.count('.quiz .qq[data-i]');
    for (let i = 0; i < n; i++) {
      const sel = `.qq[data-i="${i}"] .qq-c, .qq[data-i="${i}"] .qq-t`;
      if (!(await p.has(sel))) continue;
      const r = await reachable(p, sel);
      if (r.found && (r.covered || !r.onScreen)) blocked.push({ q: i + 1, ...r });
    }
    const go = await reachable(p, '.quiz .quiz-go');
    if (go.found && (go.covered || !go.onScreen)) blocked.push({ q: 'Submit', ...go });
    console.log('    [kyle] unreachable quiz controls:', JSON.stringify(blocked));
    assert.deepEqual(blocked.map(b => b.q), [],
      'these quiz controls cannot be clicked where they sit — ' + JSON.stringify(blocked));
  });

  await t.test('quiz: prompts render their maths and markdown', async () => {
    if (!hasQuiz) return;
    const raw = await p.eval(`JSON.stringify([...document.querySelectorAll('.qq-p, .qq-c')]
      .map(e => e.innerText).filter(s => /\\$[^$]+\\$|\\*\\*|\\\\frac|\\\\sqrt/.test(s)).slice(0, 6))`, false).then(JSON.parse);
    assert.deepEqual(raw, [],
      'the quiz renderer escapes its text instead of rendering it (apps.js R.quiz uses esc(), ' +
      'not md()), so LaTeX and markdown reach the learner as source: ' + JSON.stringify(raw));
  });

  if (hasQuiz) {
    /* park the chat out of the way so the rest of the journey can be driven
       even when it is covering things — the coverage itself is asserted above */
    await p.eval('Chat.applyPlace("mini")', false);
    await sleep(600);

    await t.test('quiz: answering question 5 does not throw you back to question 1', async () => {
      /* the quiz only scrolls when it is taller than its tile, which depends
         on how many questions the agent wrote — pin the height so the check
         is the same every run, then put it back */
      const r = await p.eval(`(() => {
        const body = document.querySelector('.quiz').closest('.tile-body');
        const prev = body.style.maxHeight;
        body.style.maxHeight = '220px';
        body.scrollTop = body.scrollHeight;
        const before = body.scrollTop;
        if (!before) { body.style.maxHeight = prev; return { skip: true }; }
        [...document.querySelectorAll('.qq-c')].pop().click();
        const after = body.scrollTop;
        body.style.maxHeight = prev;
        return { before, after };
      })()`, false);
      if (r.skip) { console.log('    [kyle] quiz fits without scrolling — scroll check skipped'); return; }
      console.log('    [kyle] quiz scrollTop before/after answering:', r.before, '→', r.after);
      assert.ok(r.after >= r.before - 8,
        `choosing an answer scrolled the quiz from ${r.before} back to ${r.after}. ` +
        'R.quiz in apps.js rewrites the whole tile body (el.innerHTML = …) on every click, ' +
        'so the scroll position is lost — answering the later questions is a fight, and the ' +
        'Submit button below them is pushed off screen again after every choice.');
    });

    const n = await p.count('.quiz .qq[data-i]');
    console.log('    [kyle] quiz questions:', n, '· mc options:', await p.count('.quiz .qq-c'));
    for (let i = 0; i < n; i++) {
      const mc = await p.eval(`!!document.querySelector('.qq[data-i="${i}"] .qq-c')`, false);
      if (mc) {
        await p.eval(`document.querySelector('.qq[data-i="${i}"] .qq-c').scrollIntoView({ block: 'center' })`, false);
        await sleep(150);
        await p.click(`.qq[data-i="${i}"] .qq-c`);
      } else await p.eval(`(() => { const t = document.querySelector('.qq[data-i="${i}"] .qq-t');
        if (t) { t.value = 'Attention scores every pair of tokens, softmaxes the scores, and mixes the value vectors.';
                 t.dispatchEvent(new Event('input')); } })()`, false);
    }
    await p.shot(SHOTS + '/kyle-05-quiz-answered.png');

    await t.test('quiz: a chosen answer is visibly chosen', async () => {
      assert.ok(await p.count('.qq-c.sel') >= 1, 'clicking an option must mark it as selected');
    });

    await p.eval('window.confirm = () => true', false);
    const sinceQuiz = await streamDone(p);
    /* the click loop above scrolled the tile back to the top every time (see
       the scroll subtest), so put Submit back on screen before pressing it */
    await p.eval(`document.querySelector('.quiz .quiz-go').scrollIntoView({ block: 'center' })`, false);
    await sleep(400);
    await p.click('.quiz .quiz-go');

    await t.test('quiz: the result renders — score, right/wrong marks, explanations', async () => {
      await p.waitFor('document.querySelector(".quiz-score")', 30000, 'a score to come back');
      const score = await p.text('.quiz-score');
      assert.match(score, /\d+\s*\/\s*\d+\s*correct/i, 'the score should read "n/m correct", got: ' + score);
      assert.ok(await p.count('.qq-c.right') >= 1, 'the right option must be marked on every question');
      assert.ok(await p.count('.qq-ex') >= 1, 'each graded question should carry its explanation');
      assert.equal(await p.count('.quiz-go'), 0, 'a submitted quiz must not still offer Submit');
      assert.ok(await p.eval('[...document.querySelectorAll(".qq-c")].every(b => b.disabled)', false),
        'the options must lock once submitted');
    });
    await p.shot(SHOTS + '/kyle-06-quiz-result.png');

    /* submitting sends the results back to the agent, which starts a turn */
    await t.test('quiz: submitting hands the grade back to the agent', async () => {
      const chip = await p.text('#chat-log .msg:last-child');
      assert.match(chip, /quiz/i, 'the submission should show in the transcript, got: ' + chip);
      assert.ok(!/artifact|#\d+/i.test(chip), 'internal ids must never reach the transcript: ' + chip);
    });
    await settle(p, sinceQuiz, { label: 'the grading turn', require: false });
    await p.shot(SHOTS + '/kyle-07-after-grade.png');
  }

  /* ------------------- flashcards ------------------- */
  await p.eval('Chat.applyPlace("mini")', false);
  await sleep(500);
  await t.test('flashcards: a card flips and the deck advances', async () => {
    if (!(await p.has('.fc-card'))) {
      console.log('    [kyle] no flashcards window is open — deck not exercised');
      return;
    }
    assert.ok((await p.text('.fc-front')).trim().length > 1, 'a card must have a question on it');
    const progress = await p.text('.fc-topic');
    await p.click('.fc-card');
    await p.waitFor('document.querySelector(".fc-card.flip")', 6000, 'the card to flip');
    assert.ok((await p.text('.fc-back')).trim().length > 1, 'the back must carry the answer');
    await p.shot(SHOTS + '/kyle-08-flashcards.png');
    await p.click('[data-a=got]');
    await sleep(500);
    assert.notEqual(await p.text('.fc-topic'), progress, '"Got it" must move the deck on');
    assert.equal(await p.count('.fc-card.flip'), 0, 'the next card must arrive face down');
  });

  /* ------------------- dragging the chat surface ------------------- */
  await t.test('chat: the grip drags the dock, and it stays where it is dropped', async () => {
    await p.eval('Chat.applyPlace("center")', false);
    await sleep(500);
    assert.equal(await p.eval('document.body.classList.contains("acting")', false), false,
      'body.acting is stuck on, and chat.js refuses to start a drag while it is (chat.js:81)');
    const start = await p.box('#chatdock');

    /* it must travel with the cursor, not merely light up a drop zone */
    const moved = await p.eval(`(async () => {
      const grip = document.getElementById('chat-grip').getBoundingClientRect();
      const dock = document.getElementById('chatdock');
      const x0 = Math.round(grip.x + grip.width / 2), y0 = Math.round(grip.y + grip.height / 2);
      const fire = (type, x, y, buttons) => window.dispatchEvent(new MouseEvent(type,
        { clientX: x, clientY: y, buttons, bubbles: true }));
      document.getElementById('chat-grip').dispatchEvent(new MouseEvent('mousedown',
        { clientX: x0, clientY: y0, button: 0, buttons: 1, bubbles: true }));
      fire('mousemove', x0 - 60, y0, 1);
      fire('mousemove', 120, y0, 1);
      await new Promise(r => requestAnimationFrame(r));
      const out = {
        dx: getComputedStyle(dock).getPropertyValue('--drag-x').trim(),
        lifted: document.body.classList.contains('chat-lifted'),
        zone: (document.querySelector('.zone.arm') || {}).id || null,
      };
      fire('mouseup', 120, y0, 0);
      return out;
    })()`);
    assert.ok(moved.lifted, 'the dock must lift while it is being dragged');
    assert.ok(moved.dx && parseFloat(moved.dx) < -50,
      'the panel must travel with the cursor, not sit still — --drag-x was ' + JSON.stringify(moved.dx));
    assert.equal(moved.zone, 'zone-left', 'dragging to the left edge should arm the left dock');

    await sleep(600);
    assert.equal(await p.eval('Chat.place()', false), 'left', 'it must stay where it was dropped');
    const end = await p.box('#chatdock');
    assert.ok(end.x < start.x - 100, `the dock did not move: ${start.x} → ${end.x}`);
    assert.ok(end.x >= -2 && end.right <= (await p.eval('innerWidth', false)) + 2,
      'the docked chat must stay inside the viewport');
    const g = await geometry(p);
    console.log('    [kyle] docked-left coverage:', JSON.stringify(g.covered));
    await p.shot(SHOTS + '/kyle-09-chat-left.png');
    assert.deepEqual(g.pairs, [], 'tiles overlap after the dock moved');
    assert.deepEqual(g.covered.filter(c => c.pct > 25), [],
      'docked left, the chat still sits on top of the workspace: ' + JSON.stringify(g.covered));
  });

  await t.test('errors: nothing threw in the browser', async () => {
    assert.deepEqual(cleanErrors(p), [], 'uncaught page errors during the journey');
  });

  /* ------------------- the same workspace at two other sizes ------------------- */
  for (const [label, w, h, cdp] of [['1024x768', 1024, 768, CDP_SMALL], ['1600x1000', 1600, 1000, CDP_BIG]]) {
    await t.test(`layout: ${label} — nothing overlaps or overflows`, async () => {
      const br2 = await open({ headless: true, width: w, height: h, port: cdp });
      try {
        const q = await br2.page(app.url + `/?session=${sid}`);
        await signIn(q, { baseline: false });
        await q.waitFor('document.querySelector(".tile")', 25000, 'the workspace to restore');
        await sleep(3000);
        await q.shot(SHOTS + `/kyle-10-${w}x${h}.png`);

        const g = await geometry(q);
        console.log(`    [kyle] ${label}: tiles ${g.tiles.map(x => x.name).join('+')} · coverage ${JSON.stringify(g.covered)}`);
        assert.equal(g.vw, w, 'the viewport should be the size we asked for');
        assert.deepEqual(g.pairs, [], `tiles overlap at ${label}`);
        for (const tile of g.tiles) {
          assert.ok(tile.x >= -2 && tile.right <= w + 2,
            `the ${tile.name} tile hangs outside the viewport at ${label}: ${JSON.stringify(tile)}`);
          assert.ok(tile.y >= -2 && tile.bottom <= h + 2,
            `the ${tile.name} tile hangs below the fold at ${label}: ${JSON.stringify(tile)}`);
        }
        assert.deepEqual(await horizontalOverflow(q), [], `something overflows sideways at ${label}`);

        /* the primary control on the spine must be operable at any size */
        for (const sel of ['.pn-go', '.pn-stuck']) {
          if (!(await q.has(sel))) continue;
          const r = await reachable(q, sel);
          assert.ok(!r.covered && r.onScreen,
            `"${(await q.text(sel)).trim()}" cannot be clicked at ${label} — ` +
            (r.onScreen ? `it is underneath ${r.hit}${r.byChat ? ' (the chat dock)' : ''}` : 'it is off screen'));
        }
        assert.deepEqual(g.covered.filter(c => c.pct > 25), [],
          `the chat dock buries the workspace at ${label}`);
        assert.deepEqual(q.errors.filter(e => !/favicon/i.test(e)), [], `page errors at ${label}`);
      } finally {
        await br2.close();
      }
    });
  }
});

})();
