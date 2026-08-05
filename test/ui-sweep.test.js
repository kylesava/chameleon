/* Visual + interaction QA sweep: every app window at every size, at three
   viewports, plus the chat dock, the status pill, animation hygiene and the
   keyboard. No agent turns — state is seeded through the test-only endpoints
   and the layout API, and populated artifacts are injected into Apps' render
   context (the same seam `_states.html` uses).

   Run:  node --test test/ui-sweep.test.js

   Caveat for anyone reading the screenshots: the driver launches Chrome with
   --hide-scrollbars, so a scrollable region looks like a hard clip. The probes
   below distinguish the two (`clipped-no-scroller` = genuinely unreachable,
   `control-below-the-fold` = reachable by scrolling).

   These tests report rather than fail: every check prints into a === SECTION ===
   block so one run gives the whole picture. What it found on 2026-08-04 (all
   three viewports unless stated):

   1  A window opened from the apps launcher before the first message is
      invisible: `body.chat-center` keeps #workspace at opacity 0 / pointer-
      events none, and nothing clears it (main.js openApp path, style.css
      `body.chat-center #workspace`).
   2  The plan's "I'm ready — next step" / "I'm stuck" buttons are unreachable
      whenever the tile body is under ~285px: `.plan` is a flex column whose
      only scroller is `.plan-body`, so the step card overflows into
      `.tile-body { overflow: hidden }`. Hits size s everywhere and size m at
      1024x768.
   3  The centre-docked chat card overlaps the app windows — 105px with two
      messages, 383px with ten — because metrics() reserves a flat 92px strip.
   4  The ephemeral status pill sits on top of a tile in centre and mini
      placements, while acting and while idle.
   5  The minimised pill overlaps the bottom row of tiles by ~19px (MINI_H=60
      in main.js vs 85-119px actual).
   6  Podcast at size s (2x1) hides its own play button, unreachably.
   7  Closing the plan window and reloading brings it back.
   8  Tab walks through 17 invisible controls before reaching anything real and
      never reaches the composer; Escape closes neither popover. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep, PACE, pickPace } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');
const shot = (p, name) => p.shot(path.join(SHOTS, `sweep-${name}.png`));

const APPS = ['plan', 'sources', 'lesson', 'quiz', 'flashcards', 'podcast', 'deck'];
const SIZES = ['s', 'm', 'l', 'xl'];
const VIEWPORTS = [[1440, 900], [1280, 800], [1024, 768]];

const note = (bucket, o) => { bucket.push(o); };
const dump = (label, rows) => {
  console.log(`\n=== ${label} (${rows.length}) ===`);
  for (const r of rows) console.log('  ' + JSON.stringify(r));
};

/* ---------------------------------------------------------------- helpers */

/* Sign in, and clear the baseline if this user has not answered it yet (the
   profile lives server-side, so only the first browser sees the questions).
   These answers deliberately keep the plan in a WINDOW — this sweep is about
   the tiled workspace, and the plan-in-the-conversation variant has its own
   suite in ui-chatplan.test.js. */
async function signIn(p, user = 'kyle', pass = 'YoungGuy', mode = 'sprint') {
  await p.waitFor('document.querySelector("#gate-form")', 15000, 'login form');
  await p.fill('#gate-user', user);
  await p.fill('#gate-pass', pass);
  await p.click('#gate-form button');
  await p.waitFor('document.querySelector("#pace") || !document.getElementById("gate")',
    15000, 'the dial or the workspace');
  // only the first browser sees the dial — the profile lives server-side
  if (await p.has('#pace')) await pickPace(p, mode);
  await p.waitFor('!document.getElementById("gate")', 20000, 'gate to dismiss');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 15000, 'session');
  return p.eval('window.__cham.sessionId()');
}

const PLAN = {
  title: 'Understand how vaccines train the immune system',
  tasks: [
    { title: 'Get the core idea: a wanted poster, not a fight', detail: 'The vaccine hands your body a harmless mugshot of the pathogen.', done_when: 'You can say what the immune system is actually memorising', apps: ['lesson'] },
    { title: 'Name the cells that do the remembering', detail: 'B cells, T cells, and why memory cells are the point.', done_when: 'You can name three cell types and their jobs', apps: ['lesson', 'flashcards'] },
    { title: 'A goal with a deliberately very long title that has to wrap gracefully inside even the smallest tile', detail: 'and a long detail line underneath it as well, to check what wrapping does to the card', done_when: 'Nothing overflows and every control is still reachable', apps: ['quiz', 'deck'] },
  ],
};

const seedPlan = (p, sid, plan = PLAN) => p.eval(`fetch('api/test/plan', { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ session_id: ${sid}, ...${JSON.stringify(plan)} }) }).then(r => r.json())`);

const newSession = p => p.eval(`fetch('api/session', { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ title: 'sweep' }) }).then(r => r.json()).then(j => j.session.id)`);

async function seedSources(p, sid) {
  const add = (title, content) => p.eval(`fetch('api/source', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, title: ${JSON.stringify(title)}, content: ${JSON.stringify(content)} }) }).then(r => r.json())`);
  await add('My lecture notes', 'The immune system remembers pathogens by their surface proteins, and a great many more words follow here to test how the preview line truncates inside a narrow row.');
  await add('A very long pasted source title that will certainly need truncating in the row', 'body text about adjuvants and why they are in the vial at all');
  await add('Key idea', 'Memory B cells are the whole point of the exercise.');
}

/* Put an exact footprint on screen: `custom` + `at` makes the solver place the
   tile at that precise size (noGrow), which is the only way to see a real 's'
   or 'm' rather than a tile grown to fill the canvas. */
async function setLayout(p, url, sid, items) {
  await p.eval(`fetch('api/layout', { method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ session_id: ${sid}, layout: ${JSON.stringify(items)} }) }).then(r => r.json())`);
  await p.goto(`${url}/?session=${sid}`);
  await p.waitFor('document.querySelector(".tile")', 15000, 'a tile');
  await sleep(650); // entry animation + first render
}

const registry = p => p.eval('JSON.parse(JSON.stringify(Apps.REGISTRY))', false);

/* ---- geometry probes, injected into the page ---- */

const OVERLAP_FN = `(() => {
  const vis = e => { const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05; };
  const box = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const name = e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
    (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const out = [];
  const tiles = [...document.querySelectorAll('.tile')].filter(vis)
    .filter(t => !t.classList.contains('exit') && !t.classList.contains('suppressed'));
  const pairs = [];
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) pairs.push(['tile/tile', tiles[i], tiles[j]]);
  const dock = document.getElementById('chatdock');
  const bar = document.getElementById('topbar');
  const status = document.getElementById('chat-status');
  const dockVisible = dock && vis(dock) && !document.body.classList.contains('chat-center');
  for (const t of tiles) {
    if (dockVisible) pairs.push(['tile/chatdock', t, dock]);
    if (bar && vis(bar)) pairs.push(['tile/topbar', t, bar]);
    if (status && vis(status)) pairs.push(['tile/status', t, status]);
  }
  if (dockVisible && bar && vis(bar)) pairs.push(['chatdock/topbar', dock, bar]);
  for (const [kind, a, b] of pairs) {
    const A = box(a), B = box(b);
    const ov = area(A, B);
    if (ov > 4) out.push({ kind, a: name(a), b: name(b),
      overlapPx: Math.round(ov),
      overlapBand: [Math.round(Math.max(A.l, B.l)), Math.round(Math.max(A.t, B.t)),
        Math.round(Math.min(A.r, B.r) - Math.max(A.l, B.l)), Math.round(Math.min(A.b, B.b) - Math.max(A.t, B.t))] });
  }
  return out;
})()`;

/* Content the tile swallows: .tile-body is overflow:hidden, so anything taller
   than the scroller inside it is simply gone. Also flags controls outside the
   tile and rows the app cannot show at all. */
const CLIP_FN = `(() => {
  const out = [];
  const scrollableY = e => { const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2; };
  /* can the learner get to this element at all? only if something between it
     and the tile body actually scrolls */
  const reachable = (e, body) => {
    for (let n = e.parentElement; n && n !== body.parentElement; n = n.parentElement)
      if (scrollableY(n)) return true;
    return false;
  };
  for (const t of document.querySelectorAll('.tile')) {
    if (t.classList.contains('exit') || t.classList.contains('suppressed')) continue;
    const app = ((t.querySelector('.tile-name') || {}).textContent || '?');
    const body = t.querySelector('.tile-body');
    if (!body) continue;
    const tr = t.getBoundingClientRect();
    if (body.scrollHeight > body.clientHeight + 2) {
      out.push({ app, kind: [...body.children].some(scrollableY) ? 'body-scrolls-but-clips' : 'clipped-no-scroller',
        hiddenPx: body.scrollHeight - body.clientHeight, bodyH: body.clientHeight });
    }
    for (const e of body.querySelectorAll('*')) {
      const s = getComputedStyle(e);
      if (s.overflowY === 'hidden' && e.scrollHeight > e.clientHeight + 4 && e.clientHeight > 24)
        out.push({ app, kind: 'inner-clip-y', sel: String(e.className || e.tagName).slice(0, 30), hiddenPx: e.scrollHeight - e.clientHeight });
      // an ellipsis is a deliberate truncation, not a clip
      if (s.overflowX === 'hidden' && s.textOverflow !== 'ellipsis' && e.scrollWidth > e.clientWidth + 4 && e.clientWidth > 40)
        out.push({ app, kind: 'inner-clip-x', sel: String(e.className || e.tagName).slice(0, 30), hiddenPx: e.scrollWidth - e.clientWidth });
    }
    for (const c of body.querySelectorAll('button, input, textarea, a')) {
      const r = c.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom > tr.bottom + 1 || r.top < tr.top - 1 || r.right > tr.right + 1 || r.left < tr.left - 1)
        out.push({ app, kind: reachable(c, body) ? 'control-below-the-fold' : 'CONTROL-UNREACHABLE',
          sel: String(c.className || c.tagName).slice(0, 24) + ':' + (c.textContent || '').trim().slice(0, 18) });
    }
  }
  return out;
})()`;

/* Anything mid-animation long after it should have settled, or left behind. */
const GHOSTS_FN = `(() => {
  const out = [];
  for (const e of document.querySelectorAll('#canvas *, #chatdock, #chatdock *, .tile, .tile *')) {
    const s = getComputedStyle(e);
    const o = parseFloat(s.opacity);
    if (o > 0.02 && o < 0.98 && !e.classList.contains('suppressed') && !e.classList.contains('tucked')
        && s.animationName === 'none' && s.transitionProperty !== 'none' && e.offsetWidth > 8) {
      // a half-faded thing that nothing is animating any more
      out.push({ sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className || '').trim().split(/\\s+/).slice(0, 2).join('.'), opacity: o });
    }
  }
  const leftovers = [...document.querySelectorAll('.tile.exit, .wave, #drop-ghost')].filter(e => {
    if (e.id === 'drop-ghost') return parseFloat(getComputedStyle(e).opacity) > 0.02;
    return true;
  }).map(e => e.className || e.id);
  return { half: out.slice(0, 12), leftovers };
})()`;

const overlaps = p => p.eval(OVERLAP_FN, false);
const clips = p => p.eval(CLIP_FN, false);
const ghosts = p => p.eval(GHOSTS_FN, false);

/* Populated artifacts, injected through the seam `_states.html` uses. There is
   no server-side seeding path for artifacts, so this is the only way to get a
   lesson/quiz/deck/flashcards/podcast on screen without an agent turn. */
const FAKE_ART = `window.__fake = {
  lesson: { id: 901, app: 'lesson', title: 'L', data: { title: 'How a vaccine trains the immune system', sections: [
    { heading: 'The wanted poster', body: 'A vaccine does not fight the disease. It hands your body **the wanted poster** so the real thing is recognised on sight.\\n\\n| Player | Job |\\n|---|---|\\n| B cell | makes antibodies |\\n| T cell | kills infected cells |' },
    { heading: 'Why the second dose', body: 'The first exposure is slow. The second is fast, and that gap is the whole point.\\n\\n> [!KEY] The one idea\\n> Memory, not muscle.' },
    { heading: 'A longer section heading that should wrap without pushing the go-deeper marker off the edge of the tile', body: 'Inline code \`antigen\` and a list:\\n\\n- one\\n- two\\n- three' },
  ] } },
  quiz: { id: 902, app: 'quiz', title: 'Q', data: { title: 'A check with a fairly long title to test wrapping', questions: [
    { type: 'mc', prompt: 'What does a vaccine actually deliver?', choices: ['A weakened fight', 'A recognisable marker', 'An antibody'], answer_index: 1, explain: 'It is the marker.' },
    { type: 'mc', prompt: 'A much longer question that runs on to check how the prompt wraps inside the tile at the smallest size available?', choices: ['A fairly long answer option that must wrap too', 'short'], answer_index: 0, explain: 'x' },
    { type: 'free', prompt: 'Explain it in your own words.' },
  ] } },
  flashcards: { id: 903, app: 'flashcards', title: 'F', data: { title: 'Deck', cards: [
    { q: 'What does a vaccine hand the immune system?', a: 'A harmless recognisable marker — the wanted poster.' },
    { q: 'A much longer question on a flashcard that needs to wrap nicely inside the flip card without overflowing it?', a: 'And an answer that is also quite long indeed, wrapping across several lines of the card.' },
  ] } },
  podcast: { id: 904, app: 'podcast', title: 'P', data: { title: 'Two hosts on immunity', description: 'A short overview', lines: [
    { host: 'A', text: 'So the vaccine is basically a wanted poster.' },
    { host: 'B', text: 'Right, and the memory cells are the detectives who keep it on file.' },
    { host: 'A', text: 'And that is why the second dose matters more than people think.' },
  ] } },
  deck: { id: 905, app: 'deck', title: 'D', data: { title: 'A deck', subtitle: 'sub', slides: [
    { layout: 'title', title: 'How Vaccines Train the Immune System', subtitle: 'A fire drill for your body', notes: 'open warm' },
    { layout: 'bullets', title: 'Bullets', bullets: ['First point', 'A considerably longer bullet point that will need to wrap on to a second line'], notes: 'n' },
    { layout: 'quote', quote: 'A vaccine does not fight the disease. It hands your body the wanted poster.', attribution: 'the point', notes: 'n' },
  ] } },
};
Apps.configure({ currentArtifact: a => window.__fake[a] || null });
true`;

const RERENDER = `(() => {
  const map = { Plan: 'plan', Notebook: 'sources', Lesson: 'lesson', Quiz: 'quiz', Flashcards: 'flashcards', Podcast: 'podcast', Deck: 'deck' };
  for (const t of document.querySelectorAll('.tile')) {
    const app = map[(t.querySelector('.tile-name') || {}).textContent];
    if (app) Apps.render(app, t.querySelector('.tile-body'), { id: app, ui: null });
  }
  return true;
})()`;

async function populate(p) {
  await p.eval(FAKE_ART, false);
  await p.eval(RERENDER, false);
  await sleep(250);
}

const openMenu = async p => {
  for (let i = 0; i < 3; i++) {
    await p.click('#apps-btn');
    await sleep(250);
    if (await p.eval('document.getElementById("appsmenu").classList.contains("open")', false)) return;
  }
  throw new Error('the apps menu will not open — is main.js throwing at boot? ' + JSON.stringify(p.errors.slice(0, 3)));
};
const openApp = async (p, id) => {
  await openMenu(p);
  await p.click(`.ap-row[data-id="${id}"]`);
  await sleep(500);
};

/* ------------------------------------------------------------------ tests */

test('sweep 1: every app at every size, at three viewports', { timeout: 900000 }, async t => {
  const app = await serve();
  t.after(async () => { await app.close(); });
  const problems = [];

  for (const [w, h] of VIEWPORTS) {
    const br = await open({ headless: true, width: w, height: h });
    const p = await br.page(app.url + '/');
    const vp = `${w}x${h}`;
    try {
      const sidPlan = await signIn(p);
      await seedPlan(p, sidPlan);
      /* Every other app gets a plan-less journey: main.js force-opens the plan
         window whenever a plan exists and the saved layout omits it, which
         would otherwise put two tiles in every shot. */
      const sidOther = await newSession(p);
      await seedSources(p, sidOther);
      const REG = await registry(p);

      for (const size of SIZES) {
        for (const id of APPS) {
          const sid = id === 'plan' ? sidPlan : sidOther;
          const [cw, ch] = REG[id].sizes[size];
          await setLayout(p, app.url, sid, [{ app: id, size, focus: true, at: { x: 0, y: 0 }, custom: { w: cw, h: ch }, userSized: true }]);
          await populate(p);
          const where = { vp, app: id, size, cells: `${cw}x${ch}` };
          const ov = await overlaps(p);
          const cl = await clips(p);
          const of = await p.overflowing();
          const tileBox = await p.box('.tile');
          const wsBox = await p.box('#workspace');
          if (ov.length) note(problems, { ...where, overlaps: ov });
          if (cl.length) note(problems, { ...where, clips: cl });
          if (of.length) note(problems, { ...where, offscreen: of });
          if (tileBox && wsBox && (tileBox.bottom > wsBox.bottom + 1 || tileBox.right > wsBox.right + 1))
            note(problems, { ...where, escapedWorkspace: { tile: tileBox, ws: wsBox } });
          if (w === 1440 || size === 's' || size === 'xl') await shot(p, `${vp}-${id}-${size}`);
        }
      }
      const errs = p.errors.filter(e => !/favicon/.test(e));
      if (errs.length) note(problems, { vp, pageErrors: errs });
    } finally {
      await br.close();
    }
  }
  dump('SIZE SWEEP', problems);
});

test('sweep 2: empty states, and the apps menu at three viewports', { timeout: 600000 }, async t => {
  const app = await serve();
  t.after(async () => { await app.close(); });
  const problems = [];
  try {
  for (const [w, h] of VIEWPORTS) {
    const br = await open({ headless: true, width: w, height: h });
    const p = await br.page(app.url + '/');
    const vp = `${w}x${h}`;
    try {
      await signIn(p);
      /* open every app from the launcher, one by one, in an empty journey */
      for (const id of APPS) {
        const before = await p.eval(`window.__cham.open()`, false);
        await openApp(p, id);
        const opened = await p.eval(`window.__cham.open()`, false);
        if (!opened.includes(id)) note(problems, { vp, app: id, issue: 'menu click did not open the window', open: opened });
        /* can the learner actually SEE what they just opened? */
        const seen = await p.eval(`(() => { const ws = document.getElementById('workspace');
          const s = getComputedStyle(ws); const t = document.querySelector('.tile');
          return { bodyClass: document.body.className, wsOpacity: s.opacity, wsPointer: s.pointerEvents,
            tiles: document.querySelectorAll('.tile').length,
            firstTileOpacity: t ? getComputedStyle(t).opacity : null }; })()`, false);
        if (parseFloat(seen.wsOpacity) < 0.99 || seen.wsPointer === 'none')
          note(problems, { vp, app: id, issue: 'the window opened but the workspace is invisible/inert (body.chat-center)', seen });
        const lost = before.filter(x => !opened.includes(x));
        if (lost.length) note(problems, { vp, app: id, issue: 'opening this window silently closed another one', lost, open: opened });
      }
      await sleep(800);
      await shot(p, `${vp}-empty-all`);

      const state = await p.eval(`(() => {
        const map = { Plan: 'plan', Notebook: 'sources', Lesson: 'lesson', Quiz: 'quiz', Flashcards: 'flashcards', Podcast: 'podcast', Deck: 'deck' };
        return [...document.querySelectorAll('.tile')].map(t => {
          const name = (t.querySelector('.tile-name') || {}).textContent;
          const b = t.querySelector('.tile-body');
          const e = b.querySelector('.app-empty');
          const r = t.getBoundingClientRect();
          return { app: map[name] || name, size: (t.querySelector('.tile-size') || {}).textContent,
            w: Math.round(r.width), h: Math.round(r.height),
            empty: !!e, text: e ? e.innerText.replace(/\\s+/g, ' ').trim() : b.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) };
        });
      })()`, false);
      console.log(`\n--- empty states ${vp} ---`);
      for (const s of state) console.log('  ' + JSON.stringify(s));

      /* every window that opened must actually say something */
      for (const s of state) if (!s.text) note(problems, { vp, app: s.app, issue: 'empty window renders nothing at all' });

      const open = await p.eval('window.__cham.open()', false);
      const dots = await p.eval(`[...document.querySelectorAll('.ap-row')].filter(r => r.classList.contains('on')).map(r => r.dataset.id)`, false);
      const tiles = state.map(s => s.app);
      if (JSON.stringify([...open].sort()) !== JSON.stringify([...dots].sort()))
        note(problems, { vp, issue: 'apps-menu dots disagree with open windows', open, dots });
      if (JSON.stringify([...open].sort()) !== JSON.stringify([...tiles].sort()))
        note(problems, { vp, issue: 'open apps disagree with rendered tiles', open, tiles });

      const ov = await overlaps(p);
      if (ov.length) note(problems, { vp, issue: 'overlap with 7 windows open', overlaps: ov });
      const cl = await clips(p);
      if (cl.length) note(problems, { vp, issue: 'clipping with 7 windows open', clips: cl });

      /* the launcher popover itself must fit on screen */
      await openMenu(p);
      const pop = await p.box('#apps-pop');
      if (pop && (pop.bottom > h - 2 || pop.right > w - 2 || pop.top < 0))
        note(problems, { vp, issue: 'apps popover off-screen', pop });
      await shot(p, `${vp}-apps-menu`);
      const errs = p.errors.filter(e => !/favicon/.test(e));
      if (errs.length) note(problems, { vp, pageErrors: errs });
    } finally {
      await br.close();
    }
  }
  } finally { dump('EMPTY STATES / LAUNCHER', problems); }
});

test('sweep 3: the chat dock — drag to every edge, the corner, and collapse', { timeout: 600000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
  const sid = await signIn(p);
  await seedPlan(p, sid);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000, 'plan');
  await openApp(p, 'lesson');
  await openApp(p, 'quiz');

  /* the drag handle only exists once there is history to hold, so give the
     surface a transcript the way a real turn would */
  await p.eval(`Chat.renderHistory([{ role: 'user', content: 'teach me about vaccines' },
    { role: 'agent', content: 'Here is the plan — we will start with what a vaccine actually hands your body.' }], true); true`, false);
  await sleep(500);
  const gripBox = await p.box('#chat-grip');
  if (!gripBox || gripBox.w === 0) note(problems, { issue: '#chat-grip has no box even with history present' });

  /* --- does the panel follow the cursor mid-drag? --- */
  const follow = await p.eval(`(async () => {
    const bar = document.getElementById('chat-bar');
    const dock = document.getElementById('chatdock');
    const r = bar.getBoundingClientRect();
    const x0 = Math.round(r.left + r.width / 2), y0 = Math.round(r.top + r.height / 2);
    const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
    fire(bar, 'mousedown', x0, y0);
    fire(window, 'mousemove', x0 - 240, y0 - 120);
    await new Promise(r2 => requestAnimationFrame(r2));
    const lifted = document.body.classList.contains('chat-lifted');
    const tf = getComputedStyle(dock).transform;
    const zones = [...document.querySelectorAll('.zone')].map(z => ({ id: z.id, armed: z.classList.contains('arm'), op: getComputedStyle(z).opacity }));
    fire(window, 'mouseup', x0 - 240, y0 - 120);
    await new Promise(r2 => setTimeout(r2, 400));
    return { lifted, transform: tf, zones, after: document.body.className };
  })()`);
  console.log('\n--- mid-drag ---\n  ' + JSON.stringify(follow));
  if (!follow.lifted) note(problems, { issue: 'dragging the chat bar does not lift the panel (no .chat-lifted)' });
  if (follow.transform === 'none') note(problems, { issue: 'the panel does not move with the cursor while dragging' });

  const sr = await p.box('#stage');
  const targets = {
    left: { x: Math.round(sr.left + 90), y: Math.round(sr.top + sr.h / 2) },
    right: { x: Math.round(sr.right - 90), y: Math.round(sr.top + sr.h / 2) },
    center: { x: Math.round(sr.left + sr.w / 2), y: Math.round(sr.bottom - 200) },
    mini: { x: Math.round(sr.right - 80), y: Math.round(sr.bottom - 40) },
  };
  for (const [want, to] of Object.entries(targets)) {
    await p.drag('#chat-grip', to);
    await sleep(900);
    const cls = await p.eval('document.body.className', false);
    if (!cls.includes('place-' + want)) note(problems, { drag: want, issue: 'did not dock where it was dropped', bodyClass: cls });
    const dock = await p.box('#chatdock');
    const vpw = 1440, vph = 900;
    if (dock.left < -2 || dock.right > vpw + 2 || dock.top < -2 || dock.bottom > vph + 2)
      note(problems, { drag: want, issue: 'dock is partly off-screen', dock });
    const ov = await overlaps(p);
    if (ov.length) note(problems, { drag: want, overlaps: ov });
    const of = await p.overflowing();
    if (of.length) note(problems, { drag: want, offscreen: of });
    await shot(p, `dock-${want}`);
  }

  /* minimised: the pill must not sit on a window */
  const mini = await p.eval(`(() => {
    const d = document.getElementById('chatdock').getBoundingClientRect();
    const ws = document.getElementById('workspace').getBoundingClientRect();
    const tiles = [...document.querySelectorAll('.tile')].map(t => { const r = t.getBoundingClientRect();
      return { name: (t.querySelector('.tile-name')||{}).textContent, bottom: Math.round(r.bottom), right: Math.round(r.right) }; });
    return { dockTop: Math.round(d.top), dockH: Math.round(d.height), wsBottom: Math.round(ws.bottom), tiles };
  })()`, false);
  console.log('\n--- minimised ---\n  ' + JSON.stringify(mini));
  if (mini.dockTop < mini.wsBottom - 1)
    note(problems, { issue: 'minimised dock rises above the reserved strip', mini });

  /* click the pill to restore, then exercise the collapse chevron */
  await p.click('#chat-where');
  await sleep(800);
  const restored = await p.eval('document.body.className', false);
  if (restored.includes('place-mini')) note(problems, { issue: 'clicking the minimised pill did not restore it', bodyClass: restored });

  const chevron = [];
  for (let i = 0; i < 4; i++) {
    await p.click('#chat-collapse');
    await sleep(600);
    chevron.push(await p.eval(`(() => {
      const b = document.getElementById('chat-collapse');
      const wrap = document.getElementById('chat-log-wrap');
      const svg = b.querySelector('svg');
      return { collapsed: document.body.classList.contains('chat-collapsed'),
        rows: getComputedStyle(wrap).gridTemplateRows, op: getComputedStyle(wrap).opacity,
        logH: Math.round(document.getElementById('chat-log').getBoundingClientRect().height),
        rotate: getComputedStyle(svg).transform, title: b.title };
    })()`, false));
  }
  console.log('\n--- collapse chevron ---');
  for (const c of chevron) console.log('  ' + JSON.stringify(c));
  for (let i = 0; i < chevron.length; i++) {
    const want = i % 2 === 0;
    if (chevron[i].collapsed !== want) note(problems, { issue: 'collapse toggle out of step', i, got: chevron[i] });
    if (want && chevron[i].logH > 2) note(problems, { issue: 'history still has height while collapsed', i, got: chevron[i] });
  }
  await shot(p, 'dock-collapsed');

  const errs = p.errors.filter(e => !/favicon/.test(e));
  if (errs.length) note(problems, { pageErrors: errs });
  } finally { dump('CHAT DOCK', problems); }
});

test('sweep 4: the working status pill never floats over a window', { timeout: 600000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
  const sid = await signIn(p);
  await seedPlan(p, sid);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000, 'plan');
  await openApp(p, 'lesson');
  await openApp(p, 'sources');
  await p.eval(`Chat.renderHistory([{ role: 'user', content: 'teach me about vaccines' }], true); true`, false);
  await sleep(400);

  for (const place of ['center', 'left', 'right', 'mini']) {
    for (const acting of [false, true]) {
      await p.eval(`Chat.applyPlace('${place}'); document.body.classList.add('busy');
        document.body.classList.toggle('acting', ${acting});
        Chat.setStatus('Writing your lesson — three sections and a diagram'); true`, false);
      await sleep(700);
      const ov = await overlaps(p);
      const pill = await p.box('#chat-status');
      const dock = await p.box('#chatdock');
      const ws = await p.box('#workspace');
      const label = `${place}${acting ? '+acting' : ''}`;
      console.log(`\n--- status ${label} ---\n  pill=${JSON.stringify(pill)}\n  dock=${JSON.stringify(dock)}\n  ws=${JSON.stringify(ws)}`);
      if (ov.length) note(problems, { status: label, overlaps: ov });
      await shot(p, `status-${label}`);
    }
  }
  await p.eval(`document.body.classList.remove('busy','acting'); Chat.setStatus(null); Chat.applyPlace('center'); true`, false);
  await sleep(500);
  const after = await p.eval(`getComputedStyle(document.getElementById('chat-status')).display`, false);
  if (after !== 'none') note(problems, { issue: 'status pill stays in the layout after the turn ends', display: after });

  const errs = p.errors.filter(e => !/favicon/.test(e));
  if (errs.length) note(problems, { pageErrors: errs });
  } finally { dump('STATUS PILL', problems); }
});

test('sweep 5: windows open and close cleanly, repeatedly', { timeout: 600000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
  await signIn(p);
  const tileCount = () => p.eval('document.querySelectorAll(".tile").length', false);
  const openList = () => p.eval('window.__cham.open()', false);

  /* one app, opened and closed three times */
  for (let i = 0; i < 3; i++) {
    await openApp(p, 'lesson');
    const mid = await p.eval(`(() => { const t = document.querySelector('.tile');
      const b = t && t.querySelector('.tile-body');
      return { tiles: document.querySelectorAll('.tile').length, bodyOpacity: b ? getComputedStyle(b).opacity : null,
        entering: document.querySelectorAll('.tile.enter').length }; })()`, false);
    await sleep(700);
    const settled = await p.eval(`(() => { const b = document.querySelector('.tile .tile-body');
      return { bodyOpacity: b ? getComputedStyle(b).opacity : null, tiles: document.querySelectorAll('.tile').length }; })()`, false);
    if (settled.bodyOpacity !== null && parseFloat(settled.bodyOpacity) < 0.98)
      note(problems, { round: i, issue: 'tile body left half-faded after opening', settled, mid });
    await openApp(p, 'lesson'); // toggles it closed
    await sleep(120);
    const during = await tileCount();
    await sleep(700);
    const after = await tileCount();
    const list = await openList();
    if (after !== list.length) note(problems, { round: i, issue: 'a closed window is still in the DOM', domTiles: after, open: list });
    console.log(`  close round ${i}: tiles during=${during} after=${after} open=${JSON.stringify(list)}`);
  }

  /* rapid-fire toggling — the animation must not lose track */
  for (let i = 0; i < 6; i++) {
    await p.click('#apps-btn');
    await sleep(120);
    await p.click('.ap-row[data-id="quiz"]');
    await sleep(140);
  }
  await sleep(1200);
  const rapid = { dom: await tileCount(), open: await openList() };
  console.log('  rapid toggle: ' + JSON.stringify(rapid));
  if (rapid.dom !== rapid.open.length) note(problems, { issue: 'rapid open/close leaves stray tiles', ...rapid });

  /* all seven at once, then close_all-ish: close each from its own × button */
  for (const id of APPS) await openApp(p, id);
  await sleep(900);
  await shot(p, 'anim-all-open');
  const openedAll = await openList();
  let guard = 0;
  while ((await tileCount()) > 0 && guard++ < 12) {
    await p.eval(`(() => { const b = document.querySelector('.tile [data-a=close]'); if (b) b.click(); return true; })()`, false);
    await sleep(420);
  }
  await sleep(700);
  const end = { dom: await tileCount(), open: await openList(), g: await ghosts(p) };
  console.log('  after closing all: ' + JSON.stringify(end));
  if (end.dom !== 0 || end.open.length !== 0) note(problems, { issue: 'closing every window left something behind', end, openedAll });
  if (end.g.half.length) note(problems, { issue: 'half-faded elements left after everything closed', half: end.g.half });
  if (end.g.leftovers.length) note(problems, { issue: 'animation leftovers in the DOM', leftovers: end.g.leftovers });
  await shot(p, 'anim-all-closed');

  const errs = p.errors.filter(e => !/favicon/.test(e));
  if (errs.length) note(problems, { pageErrors: errs });
  } finally { dump('ANIMATION HYGIENE', problems); }
});

test('sweep 5b: a closed window stays closed', { timeout: 300000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
    const sid = await signIn(p);
    await seedPlan(p, sid);
    await p.goto(app.url + `/?session=${sid}`);
    await p.waitFor('document.querySelector(".plan-now")', 15000, 'plan');
    await p.eval(`document.querySelector('.tile [data-a=close]').click(); true`, false);
    await sleep(1200); // let the layout POST debounce (400ms) land
    const closed = await p.eval('window.__cham.open()', false);
    await p.goto(app.url + `/?session=${sid}`);
    await sleep(1500);
    const reopened = await p.eval('window.__cham.open()', false);
    console.log(`  closed=${JSON.stringify(closed)}  after reload=${JSON.stringify(reopened)}`);
    if (reopened.length > closed.length)
      note(problems, { issue: 'a window closed by the user comes back after a reload', closed, reopened });
  } finally { dump('WINDOW PERSISTENCE', problems); }
});

test('sweep 7: the state-matrix harness still renders every app in every state', { timeout: 300000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/_states.html');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
    await sleep(1500);
    const cells = await p.eval(`document.querySelectorAll('#grid .cell').length`, false);
    console.log('  state-matrix cells: ' + cells);
    if (!cells) note(problems, { issue: '_states.html renders nothing — the harness is broken' });
    const cl = await clips(p);
    if (cl.length) console.log('  clipping inside the matrix:\n' + cl.map(c => '    ' + JSON.stringify(c)).join('\n'));
    const empties = await p.eval(`[...document.querySelectorAll('#grid .cell')].map(c => ({
      cap: c.querySelector('.cap').textContent,
      text: (c.querySelector('.app-empty') || {}).innerText || null }))
      .filter(x => x.cap.startsWith('EMPTY'))`, false);
    console.log('\n--- empty-state copy ---');
    for (const e of empties) console.log('  ' + JSON.stringify(e));
    for (const e of empties) if (!e.text) note(problems, { issue: 'empty state renders no invitation', cap: e.cap });
    const h = await p.eval('document.body.scrollHeight', false);
    for (let y = 0, i = 0; y < h && i < 6; y += 860, i++) {
      await p.eval(`window.scrollTo(0, ${y}); true`, false);
      await sleep(400);
      await shot(p, `states-${i}`);
    }
    const errs = p.errors.filter(e => !/favicon|katex|mermaid|cdn|Failed to fetch/i.test(e));
    if (errs.length) note(problems, { pageErrors: errs.slice(0, 5) });
  } finally { dump('STATE MATRIX', problems); }
});

test('sweep 6: keyboard — focus is visible, nothing traps, Escape closes popovers', { timeout: 600000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true, width: 1440, height: 900 });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });
  const problems = [];
  try {
  const sid = await signIn(p);
  await seedPlan(p, sid);
  await p.goto(app.url + `/?session=${sid}`);
  await p.waitFor('document.querySelector(".plan-now")', 15000, 'plan');
  await openApp(p, 'sources');
  await p.eval('document.activeElement.blur(); document.body.focus(); true', false);

  const seen = [];
  for (let i = 0; i < 26; i++) {
    await p.key('Tab');
    seen.push(await p.eval(`(() => { const a = document.activeElement;
      if (!a || a === document.body) return { el: 'body' };
      const s = getComputedStyle(a); const r = a.getBoundingClientRect();
      /* is anything up the tree making this invisible or unclickable? */
      let hiddenBy = null;
      for (let e = a; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (parseFloat(cs.opacity) < 0.05 || cs.visibility === 'hidden' || cs.pointerEvents === 'none') {
          hiddenBy = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' (' + (parseFloat(cs.opacity) < 0.05 ? 'opacity 0' : cs.visibility === 'hidden' ? 'hidden' : 'pointer-events none') + ')';
          break;
        }
      }
      return { el: a.tagName.toLowerCase() + (a.id ? '#' + a.id : '') + (typeof a.className === 'string' && a.className ? '.' + a.className.trim().split(/\\s+/)[0] : ''),
        text: (a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 22),
        outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow.slice(0, 30),
        hiddenBy,
        onScreen: r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 }; })()`, false));
  }
  console.log('\n--- tab order ---');
  seen.forEach((s, i) => console.log(`  ${i}: ${JSON.stringify(s)}`));
  const uniq = [...new Set(seen.map(s => s.el))];
  if (uniq.length < 4) note(problems, { issue: 'Tab barely moves — focus may be trapped', uniq, seen: seen.slice(0, 6) });
  const hidden = seen.filter(s => s.hiddenBy);
  if (hidden.length) note(problems, { issue: 'Tab walks through invisible popover contents', count: hidden.length, first: hidden[0], last: hidden[hidden.length - 1] });
  if (!seen.some(s => s.el === 'input#chat-input')) note(problems, { issue: 'Tab never reaches the composer within 26 stops', reached: uniq });
  for (const s of seen) {
    if (s.el === 'body' || s.hiddenBy) continue;
    if (!s.onScreen) note(problems, { issue: 'focus lands on something not fully visible', el: s.el });
    if (s.outline.startsWith('none') && !/rgb/.test(s.shadow))
      note(problems, { issue: 'focused element has no visible focus indicator', el: s.el, outline: s.outline });
  }
  await shot(p, 'keyboard-focus');

  /* Escape must close what a click outside closes */
  await openMenu(p);
  await p.key('Escape');
  await sleep(300);
  const appsOpen = await p.eval('document.getElementById("appsmenu").classList.contains("open")', false);
  if (appsOpen) note(problems, { issue: 'Escape does not close the apps popover' });
  await p.click('#sess-btn');
  await sleep(300);
  await p.key('Escape');
  await sleep(300);
  const sessOpen = await p.eval('document.getElementById("sessmenu").classList.contains("open")', false);
  if (sessOpen) note(problems, { issue: 'Escape does not close the journey switcher' });
  await p.eval('document.body.click(); true', false);

  const errs = p.errors.filter(e => !/favicon/.test(e));
  if (errs.length) note(problems, { pageErrors: errs });
  } finally { dump('KEYBOARD', problems); }
});
