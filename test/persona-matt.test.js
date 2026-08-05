module.exports = (function () {
/* Skipped unless PERSONA=1. These drive whole journeys against the live
   Anthropic API — several minutes and real money per run — so they must never
   fire as a side effect of the documented `node --test "test/*.test.js"`. */
if (!process.env.PERSONA) {
  require('node:test')('persona journeys (set PERSONA=1 to run — real API calls)', { skip: true }, () => {});
  return;
}

/* Matt — the "one thing at a time" learner — driven end to end in a real
   browser against the REAL agent (this test spends Anthropic tokens).

   Matt's baseline derives maxApps:1, checkinEvery:'step', depth:'thorough'.
   Five promises are on trial, and every one of them is something a demo
   audience notices inside ten seconds:

     1. the plan is legible          — every step says what "done" looks like
     2. the app budget is enforced   — never two working windows at once
     3. pacing holds                 — the agent sets up ONE step and stops,
                                       having actually set that step up
     4. the controls work            — nothing covered, nothing dead
     5. busy means busy              — while the agent is still streaming, the
                                       UI must still be in its working state,
                                       because the stop button IS the busy state

   Everything is sampled DURING the turn, not just after it: a budget that is
   only true once the dust settles is not a budget, it is a tidy-up. A probe on
   window.fetch tees the /api/chat SSE stream so the test knows when the SERVER
   really finished, independently of what the client believes.

   The journey is one long story, so a failed check is RECORDED and the drive
   carries on — one (expensive) run should tell you everything that is wrong,
   not just the first thing. The findings are asserted at the end.

   What it caught over seven real journeys (Aug 2026):
     - .pn-go / .pn-stuck are baked with `disabled` while the turn is running
       and nothing re-renders the card when it ends, so the ONLY control a
       guided learner has to move on is dead once the agent stops. 100%.
     - the agent closes the plan window to "make room" under maxApps:1 (the
       plan is budget-exempt server-side, but the brief never says so), taking
       the current-step card off screen with it. 3 of 7.
     - a budget deadlock: `layout` adds an app to openedThisTurn even when the
       open is a no-op on an already-open window (tools.js), so one redundant
       "open plan" spends Matt's whole budget of 1 and every create_* after it
       is refused. The model then retries — and because create_* saves and
       emits the artifact BEFORE the open that throws, each retry leaves
       another copy behind. Three to five copies, turns of 141-178s, and a
       workspace with no lesson in it. 2 of 7.
     - create_lesson never checks `sections` is an array, and a bad one crashes
       the renderer on every paint: "(d.sections || []).map is not a function".
   Fixed by other work while this was being written, kept as regressions:
     - the queue running dry mid-turn used to retire the stop button early;
     - the centre chat card used to sit on top of the tiles.

   Run:  node --test test/persona-matt.test.js
   Env:  MATT_PORT (default 8931) · MATT_ASK (the request) · MATT_HEADED=1
*/
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');
const PORT = Number(process.env.MATT_PORT || 8931);
const ASK = process.env.MATT_ASK || 'I want to understand how compound interest works';

/* one thing at a time · wait for me each time · deep · reading · from scratch.
   Question 4 (modality) is multi-select and deliberately does not auto-advance. */
const BASELINE = ['guided', 'every-step', 'thorough', 'reading', 'novice'];

/* Tee the agent's SSE stream so we know when the server stopped talking. The
   client's `body.busy` is what we are trying to judge, so it cannot also be
   the thing that tells us the turn is over. */
const PROBE = `(() => {
  if (window.__probe) return 'already';
  const P = window.__probe = { events: [], startedAt: null, endedAt: null };
  const orig = window.fetch;
  window.fetch = async (...args) => {
    const url = String((args[0] && args[0].url) || args[0] || '');
    const res = await orig(...args);
    if (!/(^|\\/)api\\/chat(\\?|$)/.test(url) || !res.body) return res;
    P.startedAt = Date.now(); P.endedAt = null; P.events.length = 0;
    const [mine, theirs] = res.body.tee();
    (async () => {
      const r = mine.getReader(); const dec = new TextDecoder(); let buf = '';
      try {
        for (;;) {
          const { done, value } = await r.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\\n')) >= 0) {
            const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(line.slice(5));
              if (ev.t === 'say' || ev.t === 'thinking' || ev.t === 'draft') continue;
              P.events.push({ at: Date.now(), t: ev.t, app: ev.app || (ev.a && ev.a.app) || null,
                              a: ev.a ? ev.a.type : null, name: ev.name || null, m: ev.m || null });
            } catch {}
          }
        }
      } catch {}
      P.endedAt = Date.now();
    })();
    return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return 'installed';
})()`;

/* One eval, one snapshot of everything worth knowing at an instant. */
const SNAP = `(() => {
  const c = window.__cham || {};
  const P = window.__probe || {};
  const plan = c.plan ? c.plan() : null;
  const vis = e => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; };
  const nm = e => ((e.querySelector('.tile-name') || {}).textContent || '?');
  const live = [...document.querySelectorAll('#canvas .tile')]
    .filter(e => !e.classList.contains('exit') && !e.classList.contains('suppressed') && vis(e));
  /* two tiles drawn on top of each other is a layout failure, not a style */
  const stacked = [];
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i].getBoundingClientRect(), b = live[j].getBoundingClientRect();
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 8 && oy > 8) stacked.push(nm(live[i]) + '/' + nm(live[j]) + ' ' + Math.round(ox) + 'x' + Math.round(oy));
  }
  const go = document.querySelector('.pn-go');
  return {
    t: Date.now(),
    streaming: !!(P.startedAt && !P.endedAt),
    endedAt: P.endedAt || null,
    busy: document.body.classList.contains('busy'),
    acting: document.body.classList.contains('acting'),
    open: c.open ? c.open() : [],
    tiles: live.map(nm),
    stacked,
    pnGoDisabled: go ? !!go.disabled : null,
    status: ((document.querySelector('#chat-status span') || {}).textContent || '').trim(),
    tasks: plan ? plan.tasks.map(t => ({
      id: t.id, title: t.title, detail: t.detail, status: t.status,
      done_when: t.done_when, apps: t.apps, stage: t.stage,
    })) : null,
  };
})()`;

/* Does the chat surface sit on top of a tile? The canvas only reserves a fixed
   strip for the centre dock, so a tall history can land on the workspace. */
const OVERLAPS = `(() => {
  const d = document.getElementById('chatdock').getBoundingClientRect();
  const out = [];
  for (const t of document.querySelectorAll('#canvas .tile')) {
    if (t.classList.contains('exit') || t.classList.contains('suppressed')) continue;
    const r = t.getBoundingClientRect();
    const ox = Math.min(d.right, r.right) - Math.max(d.left, r.left);
    const oy = Math.min(d.bottom, r.bottom) - Math.max(d.top, r.top);
    if (ox > 4 && oy > 4) out.push({ tile: ((t.querySelector('.tile-name') || {}).textContent || '?'), overlapW: Math.round(ox), overlapH: Math.round(oy) });
  }
  return out;
})()`;

const nonPlanOpen = s => s.open.filter(a => a !== 'plan');
const nonPlanTiles = s => s.tiles.filter(n => n !== 'Plan');
const statuses = s => (s.tasks || []).map(t => t.status);
const liveIndex = s => (s.tasks || []).findIndex(t => t.status === 'doing');
const doneCount = s => (s.tasks || []).filter(t => t.status === 'done').length;

async function signInAsMatt(p) {
  await p.waitFor('document.querySelector("#gate-form")', 20000, 'login form');
  await p.fill('#gate-user', 'matt');
  await p.fill('#gate-pass', 'OldGuy');
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector(".gate-progress")', 20000, 'the baseline');

  const at = () => p.eval('[...document.querySelectorAll(".gate-progress i")].findIndex(i => i.classList.contains("on"))', false);
  for (const answer of BASELINE) {
    const was = await at();
    await p.click(`.gate-opt[data-v="${answer}"]`);
    await sleep(250);
    // multi-select answers toggle instead of advancing — push them along
    if (await at() === was) { await p.click('.gate-next'); await sleep(250); }
  }
  await p.waitFor('!document.getElementById("gate")', 25000, 'the gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 20000, 'the workspace to boot');
}

/* Poll for the whole time the agent is working — and for a beat after the
   server stops, so a late-arriving action is not missed. `shots` fire on the
   first sample that matches. */
async function watchTurn(p, label, opts = {}) {
  const { timeout = 300000, every = 350, settle = 3000, shots = [] } = opts;
  const pending = shots.slice();
  const samples = [];
  const t0 = Date.now();
  await p.waitFor('window.__probe && window.__probe.startedAt && !window.__probe.endedAt', 20000, `${label}: the turn to start`);
  for (;;) {
    let s = null;
    try { s = await p.eval(SNAP, false); } catch { /* mid-render; try again */ }
    if (s) {
      samples.push(s);
      for (let i = 0; i < pending.length; i++) {
        if (pending[i].when(s)) { await p.shot(path.join(SHOTS, pending[i].file)); pending.splice(i, 1); break; }
      }
      if (!s.streaming && s.endedAt && Date.now() - s.endedAt > settle && !s.busy) break;
    }
    if (Date.now() - t0 > timeout) {
      throw new Error(`${label}: the turn never finished (${Math.round((Date.now() - t0) / 1000)}s, ` +
        `last status "${samples.length ? samples[samples.length - 1].status : '?'}")`);
    }
    await sleep(every);
  }
  await sleep(500);
  const events = await p.eval('window.__probe.events', false);
  return { samples, events };
}

function digest(label, turn) {
  const { samples, events } = turn;
  const t0 = samples[0].t;
  const rel = ms => ((ms - t0) / 1000).toFixed(1) + 's';
  const worstOpen = Math.max(0, ...samples.map(s => nonPlanOpen(s).length));
  const worstTiles = Math.max(0, ...samples.map(s => nonPlanTiles(s).length));
  const firstPaint = samples.find(s => s.tiles.length > 0);
  const streamEnd = samples.find(s => s.endedAt);
  /* the moment the UI stopped looking busy while the server was still talking */
  const earlySettle = samples.find(s => !s.busy && s.streaming);
  /* the ready button dead while nothing is happening */
  const deadGo = samples.find(s => s.endedAt && !s.busy && s.pnGoDisabled === true);
  /* tiles on top of each other for longer than one enter animation */
  let run = 0, worstRun = 0, stackedExample = null;
  for (const s of samples) {
    if (s.stacked.length) { run++; if (run > worstRun) { worstRun = run; stackedExample = s.stacked.join(', '); } }
    else run = 0;
  }

  const seen = new Set();
  const trail = [];
  for (const s of samples) {
    const key = s.open.join(',') + '|' + statuses(s).join(',') + '|' + s.busy;
    if (seen.has(key)) continue;
    seen.add(key);
    trail.push(`  ${rel(s.t)} busy=${s.busy ? 'Y' : 'n'} open=[${s.open}] visible=[${s.tiles}] tasks=[${statuses(s)}]`);
  }
  console.log(`\n===== ${label}: ${samples.length} samples over ${rel(samples[samples.length - 1].t)}`);
  console.log('workspace trail:\n' + trail.join('\n'));
  console.log('server events:\n' + (events.map(e => `  ${rel(e.at)} ${e.t}${e.a ? ':' + e.a : ''}${e.app ? ' ' + e.app : ''}${e.name ? ' ' + e.name : ''}${e.m ? ' ' + e.m : ''}`).join('\n') || '  (none)'));
  console.log(`first tile on screen: ${firstPaint ? rel(firstPaint.t) : 'NEVER'}`);
  console.log(`server stream closed:  ${streamEnd ? rel(streamEnd.endedAt) : '?'}`);
  console.log(`worst simultaneous non-plan windows: state=${worstOpen} visible=${worstTiles}`);
  if (worstRun) console.log(`tiles drawn on top of each other for ${worstRun} consecutive sample(s): ${stackedExample}`);
  return {
    worstOpen, worstTiles,
    firstPaintMs: firstPaint ? firstPaint.t - t0 : null,
    totalMs: samples[samples.length - 1].t - t0,
    streamEndMs: streamEnd ? streamEnd.endedAt - t0 : null,
    earlySettleMs: earlySettle ? earlySettle.t - t0 : null,
    deadGoMs: deadGo ? deadGo.t - t0 : null,
    stackedRun: worstRun, stackedExample,
    /* did anything at all still happen after the UI said "done"? */
    workAfterSettle: earlySettle ? events.filter(e => e.at > earlySettle.t).length : 0,
  };
}

/* Only sideways spill is a layout bug: a lesson is taller than its tile on
   purpose and the inner container scrolls. Report where each offender lives,
   because "a <path> is 6000px wide" is useless without its owner. */
const sideways = async p => p.eval(`(() => {
  const named = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '');
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
    if (r.right <= innerWidth + 2 && r.left >= -2) continue;
    const chain = [];
    for (let a = e.parentElement, i = 0; a && i < 4; a = a.parentElement, i++) chain.push(named(a));
    out.push({ sel: named(e), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), inside: chain.join(' < ') });
    if (out.length >= 8) break;
  }
  return out;
})()`, false);

async function transcript(p) {
  return p.eval(`(() => ({
    agent: [...document.querySelectorAll('#chat-log .msg.agent:not(.chipline) .bubble')].map(e => e.innerText.trim()),
    narration: [...document.querySelectorAll('#chat-log .msg.agent.chipline i')].map(e => e.innerText.trim()),
  }))()`, false);
}

test('matt: one window, one step, and a plan he can act on', { timeout: 1200000 }, async t => {
  const app = await serve();
  const br = await open({ headless: !process.env.MATT_HEADED });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  /* A failed check is a finding, not the end of the journey. */
  const findings = [];
  const check = (ok, msg) => { if (!ok) { findings.push(msg); console.log('\n*** FINDING: ' + msg + '\n'); } return !!ok; };

  /* ---------------- sign in and answer the baseline as Matt ---------------- */
  await p.shot(path.join(SHOTS, 'matt-01-gate.png'));
  await signInAsMatt(p);
  await p.shot(path.join(SHOTS, 'matt-02-workspace-empty.png'));

  const me = await p.eval('fetch("api/me").then(r => r.json())');
  assert.equal(me.profile.effective.maxApps, 1, 'Matt asked for one thing at a time');
  assert.equal(me.profile.effective.checkinEvery, 'step');
  assert.equal(me.profile.effective.depth, 'thorough');
  assert.equal(me.profile.effective.priorKnowledge, 'novice');

  assert.equal(await p.eval(PROBE, false), 'installed');
  const sid = await p.eval('window.__cham.sessionId()', false);

  /* ---------------- the real ask ---------------- */
  await p.fill('#chat-input', ASK);
  await p.click('#chat-send');

  const turn1 = await watchTurn(p, 'turn 1', {
    shots: [
      { when: s => s.acting || s.tiles.length > 0, file: 'matt-03-turn1-acting.png' },
      { when: s => nonPlanOpen(s).length > 0, file: 'matt-04-turn1-second-window.png' },
    ],
  });
  const w1 = digest('turn 1', turn1);
  const end1 = turn1.samples[turn1.samples.length - 1];
  const said1 = await transcript(p);
  console.log('\nagent chat reply (turn 1): ' + (said1.agent.length ? '\n' + said1.agent.join('\n---\n') : '(NOTHING — the agent wrote no chat reply)'));
  console.log('\nnarrations (turn 1): ' + (said1.narration.length ? '\n' + said1.narration.join('\n') : '(none)'));
  console.log('\nplan: ' + JSON.stringify(end1.tasks, null, 2));
  await p.shot(path.join(SHOTS, 'matt-05-turn1-done.png'));

  const state1 = await p.eval(`fetch('api/state?session=${sid}').then(r => r.json())`);
  console.log('artifacts after turn 1: ' + JSON.stringify((state1.artifacts || []).map(a => `${a.app}:${a.title}`)));
  console.log('saved layout after turn 1: ' + JSON.stringify(state1.session.layout));

  /* A create_* tool saves and emits its artifact BEFORE the budget check that
     can refuse the open — so a refusal leaves the content behind, the model
     reads an error, and it writes the same thing again. Seen five times in one
     178-second turn. */
  const counted = {};
  for (const a of state1.artifacts || []) { const k = `${a.app}:${a.title}`; counted[k] = (counted[k] || 0) + 1; }
  const repeated = Object.entries(counted).filter(([, n]) => n > 1);
  check(repeated.length === 0, `the same artifact was written more than once in one turn: ${JSON.stringify(repeated)}`);
  check(w1.totalMs < 150000, `turn 1 took ${(w1.totalMs / 1000).toFixed(0)}s — a check-in-every-step learner is left staring at a spinner`);

  /* ---------------- 1. the plan exists and is legible ---------------- */
  assert.ok(end1.tasks && end1.tasks.length >= 2, `a plan should have been built — got ${JSON.stringify(end1.tasks)}`);

  const vague = end1.tasks.filter(x => !x.done_when || !String(x.done_when).trim());
  check(vague.length === 0, `steps with no done_when (the learner cannot tell when they are finished): ${JSON.stringify(vague.map(x => x.title))}`);
  const appless = end1.tasks.filter(x => !Array.isArray(x.apps) || !x.apps.length);
  check(appless.length === 0, `steps with no apps (the card cannot say which window it lives in): ${JSON.stringify(appless.map(x => x.title))}`);

  /* ---------------- 2. the app budget is a guarantee, not a wish ---------------- */
  check(w1.worstOpen <= 1, `Matt's budget is one window: the client held ${w1.worstOpen} non-plan windows open at once during turn 1`);
  check(w1.worstTiles <= 1, `Matt saw ${w1.worstTiles} non-plan tiles on screen at once during turn 1`);

  /* ---------------- 3. pacing: set up one step, then stop ---------------- */
  check(statuses(end1).filter(x => x === 'doing').length === 1,
    `exactly one step should be live when the turn ends — got [${statuses(end1)}]`);
  check(doneCount(end1) <= 1,
    `the agent raced ahead: ${doneCount(end1)} steps ticked off before Matt did anything — [${statuses(end1)}]`);
  check(liveIndex(end1) === doneCount(end1),
    `the live step should be the one straight after the finished ones — [${statuses(end1)}]`);

  /* "Set the step up, then stop" means the step's material exists. Stopping
     with a live step and an empty workspace is not pacing, it is a dead end. */
  const liveTask = end1.tasks[liveIndex(end1)] || null;
  const wanted = (liveTask && liveTask.apps ? liveTask.apps : []).filter(a => a !== 'plan');
  check(!wanted.length || wanted.some(a => end1.open.includes(a)),
    `the live step "${liveTask && liveTask.title}" says it lives in [${wanted}] but the turn ended with [${end1.open}] open ` +
    `and ${(state1.artifacts || []).length} artifact(s) — Matt has been handed a plan and nothing to do`);

  /* ---------------- 4. busy means busy (commandment 4) ---------------- */
  check(w1.earlySettleMs === null,
    `the workspace stopped looking busy at ${(w1.earlySettleMs / 1000).toFixed(1)}s while the agent kept streaming until ` +
    `${(w1.streamEndMs / 1000).toFixed(1)}s (${w1.workAfterSettle} more server events followed) — the stop button is gone ` +
    `and the history slides back while the agent is still working`);
  /* one tile move is 560ms (--tile-t), so three consecutive samples is not a
     transition, it is two windows sitting on top of each other */
  check(w1.stackedRun < 3,
    `two tiles were drawn on top of each other for ${w1.stackedRun} consecutive samples (~${(w1.stackedRun * 0.35).toFixed(1)}s): ${w1.stackedExample}`);

  /* ---------------- 5. the plan window survives its own turn ---------------- */
  if (!check(end1.open.includes('plan'), `the plan window is not open at the end of turn 1 — open=[${end1.open}]`)
      || !check(end1.tiles.includes('Plan'), `the plan tile is not visible — visible=[${end1.tiles}]`)) {
    // get it back so the rest of the journey can still be inspected
    await p.goto(app.url + `/?session=${sid}`);
    await p.waitFor('window.__cham && window.__cham.plan()', 20000, 'the plan after reload');
    await p.eval(PROBE, false);
    await p.shot(path.join(SHOTS, 'matt-05b-reopened.png'));
  }

  /* ---------------- 6. the current-step card is usable ---------------- */
  await p.waitFor('document.querySelector(".plan-now")', 20000, 'the current-step card');
  const innerH = await p.eval('innerHeight', false);
  const card = await p.box('.plan-now');
  check(card && card.w > 120 && card.h > 40, `the current-step card should have real size — ${JSON.stringify(card)}`);
  check(card && card.top >= 0 && card.bottom <= innerH + 1, `the current-step card is off screen — ${JSON.stringify(card)}`);
  console.log('\ncurrent-step card reads:\n' + (await p.text('.plan-now')));

  for (const sel of ['.pn-go', '.pn-stuck', '.plan-add']) {
    const top = await p.topAt(sel);
    if (!check(top, `${sel} is missing`)) continue;
    check(!top.covered, `${sel} is covered by <${top.tag} id="${top.id}" class="${top.cls}">`);
  }

  const over1 = await p.eval(OVERLAPS, false);
  check(over1.length === 0, `the chat surface sits on top of the workspace: ${JSON.stringify(over1)}`);

  if (await p.has('.tile-narr')) {
    const nt = await p.topAt('.tile-narr');
    check(nt && !nt.covered, `the agent's narration inside the tile is covered by <${nt && nt.tag} class="${nt && nt.cls}">`);
  }

  /* A disabled button is as broken as a covered one: the agent has stopped and
     is waiting for Matt, so the control that moves him on must be pressable. */
  const buttons = await p.eval(`(() => ({
    go: { text: (document.querySelector('.pn-go')||{}).innerText, disabled: !!(document.querySelector('.pn-go')||{}).disabled },
    stuck: { text: (document.querySelector('.pn-stuck')||{}).innerText, disabled: !!(document.querySelector('.pn-stuck')||{}).disabled },
    busy: document.body.classList.contains('busy'),
  }))()`, false);
  console.log('buttons after the turn: ' + JSON.stringify(buttons));
  check(!buttons.go.disabled, 'the turn is over and the agent is waiting, but "I\'m ready — next step" is still disabled');
  check(!buttons.stuck.disabled, 'the turn is over, but "I\'m stuck" is still disabled');

  const spill1 = await sideways(p);
  check(spill1.length === 0, `elements spilling sideways out of the viewport after turn 1: ${JSON.stringify(spill1)}`);

  /* ---------------- 7. "I'm ready" advances exactly one step ---------------- */
  const before = await p.eval(SNAP, false);
  const beforeLive = liveIndex(before), beforeDone = doneCount(before);
  await p.click('.pn-go');
  let started = true;
  try { await p.waitFor('window.__probe.startedAt && !window.__probe.endedAt', 12000, 'turn 2'); } catch { started = false; }
  if (!started) {
    check(false, 'clicking "I\'m ready — next step" started nothing — the guided learner has no way to move on');
    await p.eval(`document.querySelectorAll('.pn-go,.pn-stuck').forEach(b => { b.disabled = false; })`, false);
    await p.click('.pn-go');
  }

  const turn2 = await watchTurn(p, 'turn 2', {
    shots: [{ when: s => nonPlanOpen(s).length > 0, file: 'matt-06-turn2-working.png' }],
  });
  const w2 = digest('turn 2', turn2);
  const end2 = turn2.samples[turn2.samples.length - 1];
  const said2 = await transcript(p);
  console.log('\nagent chat reply (turn 2): ' + (said2.agent.length ? said2.agent[said2.agent.length - 1] : '(NOTHING)'));
  console.log('\nnarrations (turn 2):\n' + said2.narration.slice(-4).join('\n'));
  console.log('\nplan after advancing: ' + JSON.stringify(statuses(end2)));
  await p.shot(path.join(SHOTS, 'matt-07-turn2-done.png'));

  check(liveIndex(end2) === beforeLive + 1,
    `"I'm ready" should move the spine on by exactly one — was step ${beforeLive + 1}, now step ${liveIndex(end2) + 1} of ${end2.tasks.length} ([${statuses(end2)}])`);
  check(statuses(end2).filter(x => x === 'doing').length === 1,
    `still exactly one live step after advancing — got [${statuses(end2)}]`);
  check(doneCount(end2) === beforeDone + 1,
    `exactly one more step should be ticked off — [${statuses(end2)}]`);
  check(w2.worstOpen <= 1, `the budget must hold on the second turn too: ${w2.worstOpen} non-plan windows open at once`);
  check(w2.worstTiles <= 1, `Matt saw ${w2.worstTiles} non-plan tiles at once on the second turn`);
  check(w2.earlySettleMs === null,
    `turn 2 also stopped looking busy at ${(w2.earlySettleMs / 1000).toFixed(1)}s while the agent streamed until ${(w2.streamEndMs / 1000).toFixed(1)}s`);
  check(w2.deadGoMs === null, '"I\'m ready — next step" was disabled again with nothing running after turn 2');
  check(w2.stackedRun < 3, `two tiles drawn on top of each other for ${w2.stackedRun} consecutive samples on turn 2: ${w2.stackedExample}`);
  check(end2.open.includes('plan'), `the plan window is not open at the end of turn 2 — open=[${end2.open}]`);

  const over2 = await p.eval(OVERLAPS, false);
  check(over2.length === 0, `the chat surface sits on top of the workspace after turn 2: ${JSON.stringify(over2)}`);
  const spill2 = await sideways(p);
  check(spill2.length === 0, `elements spilling sideways out of the viewport after turn 2: ${JSON.stringify(spill2)}`);

  /* the material must be readable, not clipped with no way to reach it */
  const clipped = await p.eval(`(() => [...document.querySelectorAll('#canvas .tile .tile-body')]
    .map(b => ({ tile: (b.closest('.tile').querySelector('.tile-name')||{}).textContent,
                 hidden: Math.max(0, b.scrollHeight - b.clientHeight),
                 scrollable: getComputedStyle(b).overflowY }))
    .filter(x => x.hidden > 8 && x.scrollable === 'hidden'))()`, false);
  check(clipped.length === 0, `tile content is clipped with no way to scroll to it: ${JSON.stringify(clipped)}`);

  /* ---------------- 8. and it did all that without throwing ---------------- */
  const errs = p.errors.filter(e => !/favicon/i.test(e));
  check(errs.length === 0, `uncaught page errors: ${JSON.stringify(errs)}`);

  console.log(`\n===== timings: turn 1 ${(w1.totalMs / 1000).toFixed(0)}s (first tile at ${w1.firstPaintMs === null ? 'never' : (w1.firstPaintMs / 1000).toFixed(0) + 's'}), ` +
    `turn 2 ${(w2.totalMs / 1000).toFixed(0)}s (first tile at ${w2.firstPaintMs === null ? 'never' : (w2.firstPaintMs / 1000).toFixed(0) + 's'})`);

  assert.deepEqual(findings, [], `\n\n${findings.length} finding(s):\n` + findings.map((f, i) => `  ${i + 1}. ${f}`).join('\n') + '\n');
});

})();
