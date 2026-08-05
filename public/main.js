/* Orchestrator: session state, tile physics (carried from the POC), the
   one-at-a-time action queue (UX commandment 2), narration overlays, and
   the SSE event wiring into Chat. */
(async () => {
  const { REGISTRY, icon, render } = Apps;
  const GRID = Layout.GRID;
  const GAP = 15;
  const SIZE_ORDER = Layout.SIZE_ORDER;

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const appsPop = document.getElementById('apps-pop');

  const state = {
    sessionId: null,
    apps: [],          // { id, size, focus, openedAt, ui, at?, custom?, userSized? }
    counter: 0,
    dragId: null,
    resizeId: null,
    plan: null,
    sources: [],
    artifacts: [],
    currentArt: {},    // app id -> artifact id
    tts: false,
    draft: null,       // { app, field, items } — content streaming in right now
    status: {},        // app id -> ephemeral "what I'm doing" line (never chat history)
    narration: {},     // app id -> what the agent last said inside that window
    profile: null,     // effective settings for this learner
    user: null,
  };
  const tiles = new Map();

  /* Browser-side failures used to vanish silently — the workspace would just
     stop and there was nothing to look at afterwards. They now go to the same
     audit trail as everything else. */
  function report(where, e) {
    const detail = { where, message: (e && e.message) || String(e), stack: (e && e.stack || '').slice(0, 800) };
    console.error('[chameleon]', where, e);
    try {
      fetch('api/client-error', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: state.sessionId, ...detail }),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }
  window.addEventListener('error', e => report('window', e.error || e.message));
  window.addEventListener('unhandledrejection', e => report('promise', e.reason));

  const api = async (path, body, method) => {
    const res = await fetch(path.replace(/^\//, ''), {
      method: method || (body ? 'POST' : 'GET'),
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  };

  /* How this person actually works, as opposed to what they said in the
     baseline. Fire-and-forget: a dropped signal must never cost the learner
     anything, so failures are swallowed and never retried. */
  const signalled = new Set();
  function signal(kind, detail, value) {
    if (!state.sessionId) return;
    // "they use quizzes" only needs saying once per window per journey
    if (kind === 'app_used') {
      const key = `${kind}:${detail}`;
      if (signalled.has(key)) return;
      signalled.add(key);
    }
    api('api/signal', { session_id: state.sessionId, kind, detail: detail || '', value })
      .then(r => { if (r && r.profile && r.profile.effective) state.profile = r.profile.effective; })
      .catch(() => {});
  }

  /* ---------------- boot ---------------- */
  await Gate.ready();                       // sign-in and baseline come first
  document.body.classList.remove('booting');
  const params = new URLSearchParams(location.search);
  const boot = await api('api/state' + (params.has('session') ? `?session=${params.get('session')}` : ''));
  state.profile = (boot.profile && boot.profile.effective) || { maxApps: 4, checkinEvery: 'stage', depth: 'balanced' };
  state.user = boot.user || null;
  state.sessionId = boot.session.id;
  state.plan = boot.plan;
  state.sources = boot.sources;
  state.artifacts = boot.artifacts;
  state.tts = boot.tts;
  for (const a of boot.artifacts) state.currentArt[a.app] = a.id; // listed oldest→newest; last wins
  // the last thing the agent said in each window survives a reload with it,
  // tucked away rather than blanketing every tile on arrival
  for (const m of boot.messages) if (m.kind === 'narration' && m.app) state.narration[m.app] = m.content;
  let narrationRestored = Object.keys(state.narration).length > 0;

  Apps.configure({
    getPlan: () => state.plan,
    getSources: () => state.sources,
    currentArtifact: app => {
      const id = state.currentArt[app];
      return state.artifacts.find(a => a.id === id) || null;
    },
    ttsEnabled: () => state.tts,
    sessionId: () => state.sessionId,
    draftFor: app => (state.draft && state.draft.app === app ? state.draft : null),
    statusFor: app => state.status[app] || null,
    isBusy: () => document.body.classList.contains('busy'),
    api,
    sourceAdded: src => { state.sources.push(src); dirty('sources'); },
    sourceRemoved: id => { state.sources = state.sources.filter(s => s.id !== id); dirty('sources'); },
    planChanged: plan => { state.plan = plan; paintPlan(); },
    planResized: () => relayout(),
  });

  Chat.configure({
    sessionId: () => state.sessionId,
    onEvent: ev => enqueue(ev),
    onTurnDone: () => { enqueue({ t: '_end' }); },
    onPlaceChange: () => relayout(), // the canvas reclaims/yields the docked column
  });
  /* ---------------- session switcher ---------------- */
  const sessBtn = document.getElementById('sess-btn');
  const sessPop = document.getElementById('sess-pop');
  document.getElementById('sess-title').textContent = boot.session.title;
  function renderSessions() {
    sessPop.innerHTML = boot.sessions.map(s =>
      `<button class="sess-row ${s.id === state.sessionId ? 'on' : ''}" data-s="${s.id}"><b>${Apps.esc(s.title)}</b><span>${s.updated_at.slice(0, 10)}</span></button>`).join('') +
      '<button class="sess-row new" data-s="new"><b>+ New journey</b></button>';
    sessPop.querySelectorAll('.sess-row').forEach(b => b.onclick = async () => {
      if (b.dataset.s === 'new') {
        const r = await api('api/session', { title: 'New journey' });
        location.search = `?session=${r.session.id}`;
      } else location.search = `?session=${b.dataset.s}`;
    });
  }
  renderSessions();
  sessBtn.onclick = e => { e.stopPropagation(); document.getElementById('sessmenu').classList.toggle('open'); };

  /* The logo is the reset: drop every scrap of local state and come back on a
     clean session with freshly-fetched assets. A development convenience for
     now — it does not delete past journeys from the server. */
  document.getElementById('brand-mark').onclick = async () => {
    try { localStorage.clear(); sessionStorage.clear(); } catch {}
    try {
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch {}
    // a changing query defeats any cached HTML on the way back in
    location.replace(location.pathname + '?fresh=' + Date.now());
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#sessmenu')) document.getElementById('sessmenu').classList.remove('open');
    if (!e.target.closest('#appsmenu')) document.getElementById('appsmenu').classList.remove('open');
    if (!e.target.closest('#usermenu') && !e.target.closest('#user-pop')) closeSettings();
  });
  /* Escape closes whatever is open — a popover you can only dismiss by clicking
     elsewhere is a trap for anyone working from the keyboard. */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.body.classList.contains('settings-open')) { closeSettings(); userBtn.focus(); return; }
    const open = document.querySelector('#sessmenu.open, #appsmenu.open');
    if (!open) return;
    open.classList.remove('open');
    const btn = open.querySelector('button');
    if (btn) btn.focus();
  });

  /* ---------------- how you like to work ----------------
     The baseline is asked once; this is where it stays changeable. It also
     shows what Chameleon has since concluded from watching, because a system
     that quietly adapts to you should be willing to say what it has decided. */
  const userBtn = document.getElementById('user-btn');
  const userPop = document.getElementById('user-pop');
  const scrim = document.createElement('div');
  scrim.id = 'user-scrim';
  document.body.appendChild(scrim);
  const closeSettings = () => document.body.classList.remove('settings-open');
  scrim.onclick = closeSettings;
  /* Changing a setting repaints the sheet, which detaches the node that was
     clicked — so by the time the document-level "clicked outside?" handler
     runs, e.target has no ancestors and the sheet closes itself. Stop the
     click here instead of asking where it came from afterwards. */
  userPop.addEventListener('click', e => e.stopPropagation());
  let stated = (boot.profile && boot.profile.stated) || {};
  document.getElementById('user-initial').textContent =
    ((state.user && state.user.display_name) || '?').trim().charAt(0).toUpperCase();
  userBtn.title = state.user ? `${state.user.display_name} — how you like to work` : 'How you like to work';

  /* Everything that changes how Chameleon behaves, in one place, grouped the
     way a person thinks about it rather than the way the profile stores it. */
  const SETTINGS = [
    { group: 'Pacing' },
    {
      key: 'parallelism', label: 'Windows at once',
      options: [[1, 'One'], [2, 'Two'], [3, 'Three'], [4, 'Four']],
      note: 'A hard ceiling — the agent is refused if it tries to open more.',
    },
    {
      key: 'checkins', label: 'Wait for me',
      options: [['every-step', 'Every step'], ['every-stage', 'At breaks'], ['rarely', 'Never']],
      note: 'Whether it stops for you before starting the next step.',
    },

    {
      key: 'planPlace', label: 'The plan lives',
      options: [['chat', 'In the conversation'], ['window', 'In its own window']],
      note: 'In the conversation you talk to it about the plan; in a window it sits beside the work.',
    },

    { group: 'Where it talks' },
    {
      key: 'voice', label: 'Chameleon speaks',
      options: [['windows', 'In the windows'], ['both', 'Both'], ['chat', 'In chat']],
      note: 'Beside the thing being taught, or as a conversation.',
    },
    {
      key: 'chatter', label: 'Chat replies',
      options: [['minimal', 'Barely'], ['normal', 'Normal'], ['full', 'Full']],
    },

    { group: 'How it teaches' },
    {
      key: 'depth', label: 'Detail',
      options: [['concise', 'Tight'], ['balanced', 'Solid'], ['thorough', 'Deep']],
    },
    {
      key: 'visuals', label: 'Diagrams & pictures',
      options: [['plain', 'Words'], ['diagrams', 'Some'], ['rich', 'Lots']],
    },
    {
      key: 'priorKnowledge', label: 'Assume I know',
      options: [['novice', 'Nothing'], ['some', 'Some'], ['strong', 'A lot']],
    },

    { group: 'What it can build', apps: true },
  ];

  const APP_TOGGLES = ['lesson', 'quiz', 'flashcards', 'podcast', 'deck'];

  /* The one control everything hangs off. The rest still exists — it is just
     not the first thing a new person is asked to reason about. */
  const MODE_CARDS = [
    { v: 'simple', label: 'One thing at a time', sub: 'A lesson, then a quiz. Asks before moving on.' },
    { v: 'balanced', label: 'A steady pace', sub: 'Usually one thing, sometimes two. Checks in at breaks.' },
    { v: 'extreme', label: 'Everything at once', sub: 'Side by side, moving without asking.' },
  ];

  function renderUserPop() {
    const eff = state.profile || {};
    const learned = [];
    if (eff.stepsSeen) learned.push(`${eff.stepsSeen} step${eff.stepsSeen === 1 ? '' : 's'} watched`);
    if (eff.accuracy !== null && eff.accuracy !== undefined) learned.push(`${Math.round(eff.accuracy * 100)}% on quizzes`);
    if (eff.preferredApps && eff.preferredApps.length) {
      const names = eff.preferredApps.map(a => ((Apps.REGISTRY[a] || {}).name || a).toLowerCase());
      learned.push(`you reach for ${names.join(', ')}`);
    }
    if (eff.confidence >= 0.99) learned.push('now following what you do over what you ticked');

    const apps = stated.apps || {};
    const mode = (state.profile || {}).mode || 'custom';
    /* Every change repaints the whole sheet, so without this, adjusting a
       setting near the bottom throws you back to the top of the list. */
    const keepScroll = (userPop.querySelector('.up-scroll') || {}).scrollTop || 0;
    const advOpen = userPop.dataset.adv === '1';

    userPop.innerHTML = `
      <div class="up-head">
        <b>${Apps.esc((state.user && state.user.display_name) || 'You')}</b>
        <span>how you like to work</span>
      </div>
      <div class="up-body"><div class="up-scroll">
        <div class="up-modes">
          ${MODE_CARDS.map(m => `<button class="up-mode ${mode === m.v ? 'on' : ''}" data-mode="${m.v}">
            <b>${m.label}</b><span>${m.sub}</span></button>`).join('')}
        </div>
        ${mode === 'custom' ? '<span class="up-note">Tuned by hand. Pick one above to go back to a preset.</span>' : ''}

        <button class="up-adv" aria-expanded="${advOpen}">
          <span>Advanced</span>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 6.5L8 10l4-3.5"/></svg>
        </button>
        <div class="up-advbody" ${advOpen ? '' : 'hidden'}>
        ${SETTINGS.map(sec => {
    if (sec.apps) {
      return `<div class="up-group">${sec.group}</div>
          <div class="up-apps">${APP_TOGGLES.map(a => {
    const on = apps[a] !== false;
    return `<button class="up-app ${on ? 'on' : ''}" data-app="${a}" aria-pressed="${on}">
              ${Apps.icon(a)}<span>${Apps.esc((Apps.REGISTRY[a] || {}).name || a)}</span></button>`;
  }).join('')}</div>
          <span class="up-note">Switched off means never built and never offered.</span>`;
    }
    if (sec.group) return `<div class="up-group">${sec.group}</div>`;
    return `<div class="up-row" data-k="${sec.key}">
          <em>${sec.label}</em>
          <div class="up-opts">${sec.options.map(([v, label]) =>
    `<button data-v="${v}" class="${String(stated[sec.key]) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>
          ${sec.note ? `<span class="up-note">${sec.note}</span>` : ''}
        </div>`;
  }).join('')}
        </div>
      ${learned.length ? `<div class="up-learned"><em>learned so far</em><span>${Apps.esc(learned.join(' · '))}</span></div>` : ''}
      </div></div>
      <div class="up-foot">
        <button class="up-retake">Start over</button>
        <button class="up-out">Sign out</button>
      </div>`;

    const sc = userPop.querySelector('.up-scroll');
    if (sc && keepScroll) sc.scrollTop = keepScroll;

    /* Every control saves on click and reconciles with whatever the server
       actually stored — the panel never becomes the source of truth. */
    const save = async patch => {
      stated = { ...stated, ...patch };
      /* Some settings change the shape of the workspace, not just the model's
         brief — moving the plan between the chat and a window is the obvious
         one, and it has to happen as they click, not on the next reload. */
      Object.assign(state.profile, patch);
      renderUserPop();
      paintPlan();
      try {
        const r = await api('api/profile', { stated: patch });
        if (r.profile) {
          stated = r.profile.stated;
          state.profile = r.profile.effective;
          renderUserPop();
          paintPlan();
        }
      } catch { /* the next open re-reads the truth from the server */ }
    };

    userPop.querySelectorAll('.up-mode').forEach(b => b.onclick = async () => {
      const m = b.dataset.mode;
      userPop.querySelectorAll('.up-mode').forEach(x => x.classList.toggle('on', x === b));
      try {
        const r = await api('api/profile', { mode: m });
        if (r.profile) { stated = r.profile.stated; state.profile = r.profile.effective; }
      } catch { /* the next open re-reads the truth from the server */ }
      renderUserPop();
      paintPlan();
      relayout();
    });
    userPop.querySelector('.up-adv').onclick = () => {
      userPop.dataset.adv = advOpen ? '0' : '1';
      renderUserPop();
    };

    userPop.querySelectorAll('.up-opts button').forEach(b => b.onclick = () => {
      const key = b.closest('.up-row').dataset.k;
      save({ [key]: key === 'parallelism' ? Number(b.dataset.v) : b.dataset.v });
    });
    userPop.querySelectorAll('.up-app').forEach(b => b.onclick = () => {
      const a = b.dataset.app;
      const next = { ...(stated.apps || {}), [a]: (stated.apps || {})[a] === false };
      // never let them switch everything off and leave the agent nothing to do
      if (!APP_TOGGLES.some(x => next[x] !== false)) return Apps.toast('Leave at least one window on.');
      save({ apps: next });
    });
    userPop.querySelector('.up-retake').onclick = async () => {
      try { await api('api/profile', { onboarded: false }); } catch {}
      location.reload();
    };
    userPop.querySelector('.up-out').onclick = async () => {
      try { await api('api/logout', {}); } catch {}
      location.replace(location.pathname);
    };
  }
  renderUserPop();
  userBtn.onclick = e => {
    e.stopPropagation();
    renderUserPop();
    document.body.classList.toggle('settings-open');
  };

  /* ---------------- the spine ----------------
     One plan, two homes. Matt keeps it in the conversation so he can talk to
     it; Kyle keeps it in a window beside the lesson and the quiz. Which one is
     a setting, so neither has to live with the other's preference. */
  const chatPlanEl = document.getElementById('chat-plan');
  const planInChat = () => (state.profile || {}).planPlace === 'chat';

  function paintPlan() {
    document.body.classList.toggle('plan-in-chat', planInChat());
    if (planInChat()) {
      if (findApp('plan')) { closeApp('plan'); relayout(); }
      Apps.chatPlan(chatPlanEl);
      // the spine appearing must not be hidden behind a collapsed transcript
      if (state.plan && state.plan.tasks.length) Chat.showPlan();
    } else {
      chatPlanEl.hidden = true;
      chatPlanEl.innerHTML = '';
      // moving it back out of the chat has to actually put a window there
      if (state.plan && state.plan.tasks.length && !findApp('plan')) {
        openApp('plan', 'm', true);
        relayout();
        persistLayout();
      } else dirty('plan');
    }
  }

  /* ---------------- workspace state ops ---------------- */
  const findApp = id => state.apps.find(a => a.id === id);

  function openApp(id, size, focus) {
    if (!REGISTRY[id]) return null;
    let app = findApp(id);
    if (app) { if (size) app.size = size; }
    else {
      app = { id, size: size || 'm', focus: false, openedAt: ++state.counter, shownAt: Date.now(), ui: null };
      state.apps.push(app);
    }
    if (focus) setFocus(id);
    return app;
  }
  function closeApp(id) {
    const i = state.apps.findIndex(a => a.id === id);
    if (i >= 0) state.apps.splice(i, 1);
  }
  function setFocus(id) { state.apps.forEach(a => a.focus = a.id === id); }
  function dirty(id) { const a = findApp(id); if (a) { a.dirtyFlag = true; relayout(); } }

  let persistT = 0;
  function persistLayout() {
    clearTimeout(persistT);
    persistT = setTimeout(() => {
      api('api/layout', {
        session_id: state.sessionId,
        layout: state.apps.map(a => ({ app: a.id, size: a.size, focus: a.focus, at: a.at || null, custom: a.custom || null, userSized: !!a.userSized })),
      }).catch(() => {});
    }, 400);
  }

  /* restore last layout */
  for (const l of boot.session.layout || []) {
    const app = openApp(l.app, l.size, l.focus);
    if (app) {
      if (l.at) app.at = l.at;
      if (l.custom) { app.custom = l.custom; app.userSized = !!l.userSized; }
    }
  }
  /* Coming back to a journey that has a plan and no saved layout — the plan is
     where you left off, so it is what you should land on. Unless it lives in
     the conversation, in which case there is no window to open. */
  if (state.plan && state.plan.tasks.length && !(boot.session.layout || []).length
      && (boot.profile && boot.profile.effective || {}).planPlace !== 'chat') openApp('plan', 'm', true);

  /* After the workspace is known, not before: the full-screen hero is only
     right when there is genuinely nothing to come back to. */
  Chat.renderHistory(boot.messages, state.apps.length > 0); // also owns the chat-center / fused classes

  /* ---------------- the one-at-a-time action queue ---------------- */
  const queue = [];
  let playing = false;
  let fast = false;

  /* A rolling trace of everything the server told this browser to do. When a
     turn "does nothing", this is what distinguishes "the event never arrived"
     from "the event arrived and the client dropped it". */
  const trace = [];
  function enqueue(ev) {
    trace.push({ t: ev.t, a: ev.a ? `${ev.a.type}:${ev.a.app || ''}` : (ev.app || undefined) });
    if (trace.length > 300) trace.shift();
    /* Commandment 7: showing what's happening RIGHT NOW never waits in line
       behind the pacing queue — these are a live view of the current step,
       not a new step competing for attention. */
    if (ev.t === 'tool_start') { beginDrafting(ev); return; }
    if (ev.t === 'draft') { applyDraft(ev); return; }
    if (ev.t === 'thinking') { showThinking(ev.d); return; }
    queue.push(ev);
    if (!playing) playQueue();
  }

  /* The model reasoning out loud, shown in the composer strip as it forms.
     Keeps only the newest sentence — this is a pulse, not a transcript. */
  let thinkBuf = '';
  function showThinking(delta) {
    thinkBuf += delta;
    const parts = thinkBuf.split(/(?<=[.!?])\s+/).filter(s => s.trim());
    const latest = (parts[parts.length - 1] || '').trim();
    if (latest.length > 2) Chat.setStatus(latest.length > 120 ? latest.slice(0, 118) + '…' : latest, true);
  }

  function beginDrafting(ev) {
    thinkBuf = '';
    if (ev.status) setStatus(ev.app, ev.status);
    if (!ev.app) return;
    state.draft = { app: ev.app, field: ev.field || null, items: [] };
    document.body.classList.add('acting');
    /* When the spine lives in the conversation there is no tile to open — the
       plan writes itself into the chat surface instead. Opening one anyway put
       a plan window on screen for exactly the learner who asked never to have
       one. */
    if (ev.app === 'plan' && planInChat()) { Chat.showPlan(); paintPlan(); return; }
    // open the tile FIRST so the content has somewhere visible to land
    applyAction({ type: 'open', app: ev.app, size: ev.size || 'm', focus: true });
  }

  /* Each draft event is a full snapshot — the trailing item grows as its text
     arrives. Repaint on an animation frame so a fast stream stays smooth. */
  let draftRaf = 0;
  function applyDraft(ev) {
    state.draft = { app: ev.app, field: ev.field, head: ev.head || {}, items: ev.items || [] };
    if (ev.app === 'plan' && planInChat()) {
      cancelAnimationFrame(draftRaf);
      draftRaf = requestAnimationFrame(() => paintPlan());
      return;
    }
    const app = findApp(ev.app);
    if (!app) return;
    app.ui = null;
    cancelAnimationFrame(draftRaf);
    draftRaf = requestAnimationFrame(() => {
      const t = tiles.get(ev.app);
      if (t) renderTile(app, t, { instant: true });
      else dirty(ev.app);
    });
  }

  /* ephemeral status: lives in the tile + the composer strip, never in history */
  function setStatus(app, text) {
    if (app) {
      state.status[app] = text;
      const t = tiles.get(app);
      if (t) paintStatus(app);
    }
    Chat.setStatus(text);
  }
  function clearStatus() {
    for (const app of Object.keys(state.status)) {
      delete state.status[app];
      paintStatus(app);
    }
    Chat.setStatus(null);
  }
  function paintStatus(appId) {
    const t = tiles.get(appId);
    if (!t) return;
    const txt = state.status[appId];
    let el = t.el.querySelector('.tile-status');
    if (!txt) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'tile-status';
      el.innerHTML = '<i class="ts-dot"></i><span></span>';
      t.el.querySelector('.tile-head').after(el);
    }
    el.querySelector('span').textContent = txt;
  }
  const sleep = ms => new Promise(r => setTimeout(r, fast ? 0 : ms));

  async function playQueue() {
    playing = true;
    try {
      await drainQueue();
    } catch (e) {
      report('playQueue', e);
    } finally {
      playing = false;
      /* A safety net for a queue that died, not a turn-end detector. The queue
         runs dry many times during a normal turn — settling here while the
         stream is still open would retire the stop control, bring the history
         back, and tell the learner it had finished while it was still working. */
      if (!queue.length && document.body.classList.contains('busy') && !Chat.streaming()) {
        document.body.classList.remove('acting');
        Chat.tuck(state.apps.length > 0);
        Chat.turnSettled();
      }
    }
  }

  async function drainQueue() {
    while (queue.length) {
      const ev = queue.shift();
      if (ev.t === '_end') {
        fast = false;
        state.draft = null;
        clearStatus();
        document.body.classList.remove('acting');
        Chat.tuck(state.apps.length > 0);
        Chat.turnSettled();
        /* The step card disables "I'm ready" while the agent is working. It has
           to be redrawn once that stops, or the one button the learner is meant
           to press stays dead until something else happens to repaint it. */
        paintPlan();
        continue;
      }
      document.body.classList.add('acting'); // history yields to the workspace
      // One bad step must never strand the whole turn: without this, a throw
      // here leaves `playing` true, the queue frozen and the history hidden —
      // which looks exactly like "it did nothing".
      try { playStep(ev); }
      catch (e) { report('playStep:' + ev.t, e); }
      // One thing at a time still, but paced to feel immediate. Narration gets
      // a beat to be read; a layout change just needs to register.
      await sleep(ev.t === 'narrate' ? 900 : queue.length > 2 ? 180 : 360);
    }
  }
  // A pressed stop fast-forwards what already arrived so client and server
  // state stay in sync — stopping aborts the agent, not the bookkeeping.
  window.addEventListener('chameleon:stopped', () => { fast = true; });

  function playStep(ev) {
    switch (ev.t) {
      case 'action': applyAction(ev.a); break;
      /* The learner coached the product from the chat and the agent recorded
         it. Apply it now so the change is visible in the same breath as the
         acknowledgement, rather than on the next reload. */
      case 'preference': {
        Object.assign(state.profile, ev.patch || {});
        if (ev.patch && ev.patch.parallelism) state.profile.maxApps = ev.patch.parallelism;
        stated = { ...stated, ...(ev.patch || {}) };
        if (ev.patch && ev.patch.apps) stated.apps = { ...(stated.apps || {}), ...ev.patch.apps };
        renderUserPop();
        paintPlan();
        Apps.toast('Got it — saved to your settings.', 'good');
        api('api/me').then(r => {
          if (r && r.profile) { state.profile = r.profile.effective; stated = r.profile.stated; renderUserPop(); paintPlan(); }
        }).catch(() => {});
        break;
      }

      case 'narrate': {
        Chat.addNarration(ev.app, ev.text);
        narrateInTile(ev.app, ev.text);
        break;
      }
      case 'plan': {
        state.plan = ev.plan;
        if (state.draft && state.draft.app === 'plan') state.draft = null;
        delete state.status.plan;
        paintStatus('plan');
        paintPlan();
        break;
      }
      case 'artifact': {
        const i = state.artifacts.findIndex(a => a.id === ev.artifact.id);
        if (i >= 0) state.artifacts[i] = ev.artifact; else state.artifacts.push(ev.artifact);
        state.currentArt[ev.app] = ev.artifact.id;
        // the finished thing replaces the draft it was streaming into
        if (state.draft && state.draft.app === ev.app) state.draft = null;
        delete state.status[ev.app];
        paintStatus(ev.app);
        const app = findApp(ev.app);
        if (app) app.ui = null;
        dirty(ev.app);
        break;
      }
      case 'source': {
        state.sources.push(ev.source);
        dirty('sources');
        break;
      }
    }
  }

  function applyAction(a) {
    switch (a.type) {
      case 'open': {
        openApp(a.app, a.size || 'm', a.focus !== false);
        const ap = findApp(a.app);
        if (ap) { delete ap.at; delete ap.custom; ap.userSized = false; } // agent placement wins
        break;
      }
      case 'close': closeApp(a.app); break;
      case 'resize': {
        const ap = findApp(a.app);
        if (ap && SIZE_ORDER.includes(a.size)) { ap.size = a.size; ap.userSized = false; delete ap.custom; }
        break;
      }
      case 'focus': if (findApp(a.app)) setFocus(a.app); break;
      case 'close_all': state.apps.length = 0; break;
    }
    relayout();
    if ((a.type === 'open' || a.type === 'resize' || a.type === 'focus') && REGISTRY[a.app]) {
      setTimeout(() => {
        const t = tiles.get(a.app);
        if (!t) return;
        spawnWaves(t.el, { rings: 1, spread: 110, dur: 720, color: `hsl(${REGISTRY[a.app].hue} 85% 68% / 0.5)` });
        t.el.classList.remove('pulse');
        void t.el.offsetWidth;
        t.el.classList.add('pulse');
        setTimeout(() => t.el.classList.remove('pulse'), 950);
      }, 80);
    }
  }

  /* Narration inside the app window (commandment 3) — the primary voice.
     It types in, then STAYS until the agent says something else there or the
     learner dismisses it, so the app window carries the teaching rather than
     the transcript. */
  function narrateInTile(appId, text) {
    narrationRestored = false; // a live line arrives open, not tucked
    state.narration[appId] = text;
    paintNarration(appId);
  }

  function paintNarration(appId) {
    const t = tiles.get(appId);
    if (!t) return;
    const text = state.narration[appId];
    const existing = t.el.querySelector('.tile-narr');
    if (!text) { existing?.remove(); t.body.style.paddingBottom = ''; t.body.style.paddingRight = ''; return; }
    if (existing && existing.dataset.text === text) return;
    existing?.remove();

    const n = document.createElement('div');
    // restored-from-history lines start tucked: they are context, not news
    n.className = 'tile-narr' + (narrationRestored ? ' tucked instant' : '');
    n.dataset.text = text;
    n.innerHTML = `<img src="chameleon.png" alt=""><span></span><button class="narr-x" title="Dismiss">×</button>`;
    t.el.appendChild(n);
    // reserve room so neither the open bubble nor the tucked avatar ever sits
    // on top of the tile's own content
    const reserve = () => {
      const tucked = n.classList.contains('tucked');
      t.body.style.paddingBottom = tucked ? '' : (n.offsetHeight + 16) + 'px';
      t.body.style.paddingRight = tucked ? '38px' : '';
    };
    requestAnimationFrame(reserve);

    /* After a while it tucks itself into a small avatar in the corner rather
       than sitting on the content forever — hover or click to read it again.
       Nothing is lost, nothing is permanently covered. */
    const tuck = () => { n.classList.add('tucked'); t.body.style.paddingBottom = ''; };
    clearTimeout(t.narrTuck);
    t.narrTuck = setTimeout(tuck, Math.min(5000 + text.length * 45, 14000));
    n.onclick = e => {
      if (e.target.closest('.narr-x')) return;
      clearTimeout(t.narrTuck);
      n.classList.toggle('tucked');
      requestAnimationFrame(reserve);
      if (!n.classList.contains('tucked')) t.narrTuck = setTimeout(tuck, 9000);
    };
    n.querySelector('.narr-x').onclick = e => {
      e.stopPropagation();
      clearTimeout(t.narrTuck);
      delete state.narration[appId];
      n.classList.add('out');
      t.body.style.paddingBottom = '';
      t.body.style.paddingRight = '';
      setTimeout(() => n.remove(), 300);
    };
    const span = n.querySelector('span');
    clearInterval(t.narrTimer);
    if (n.classList.contains('tucked')) { span.textContent = text; return; }
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 45));
    t.narrTimer = setInterval(() => {
      i += step;
      span.textContent = text.slice(0, i);
      if (i >= text.length) { span.textContent = text; clearInterval(t.narrTimer); }
    }, 22);
  }

  /* ---------------- layout + tile DOM (carried from the POC) ---------------- */
  const DOCK_W = 400; // keep in sync with --dock-side-w in style.css
  const MINI_H = 96;  // the minimised pill's real footprint (see body.place-mini)
  function metrics() {
    const r = stage.getBoundingClientRect();
    const centered = document.body.classList.contains('chat-center');
    const place = Chat.place();
    let width = r.width - 28;
    let height = r.height - 28;
    if (!centered) {
      // a side dock takes its own column; the centre dock reserves a bottom strip
      if (place === 'left' || place === 'right') width -= DOCK_W + 12;
      /* The centred card floats over the canvas, and it is no longer a fixed
         height — with the plan living inside it, it grows with the plan. Measure
         it rather than guessing, so a tile is never drawn underneath it. */
      else if (place !== 'mini') {
        const dockEl = document.getElementById('chatdock');
        const h = dockEl ? dockEl.getBoundingClientRect().height : 0;
        height -= Math.max(132, Math.min(Math.round(h) + 18, Math.round(r.height * 0.62)));
      }
      else height -= MINI_H;
    }
    return {
      cw: (width - GAP * (GRID.cols - 1)) / GRID.cols,
      ch: (height - GAP * (GRID.rows - 1)) / GRID.rows,
      width,
    };
  }

  function relayout() {
    let result;
    let guard = 0;
    while (true) {
      const items = state.apps.map(a => ({
        id: a.id, size: a.size, focus: a.focus, openedAt: a.openedAt, at: a.at || null,
        noGrow: !!a.userSized,
        custom: a.custom || null,
        touched: a.touched || 0,
        force: a.id === state.resizeId,
        spec: { sizes: REGISTRY[a.id].sizes, max: REGISTRY[a.id].max },
      }));
      result = Layout.solve(items, GRID);
      if (!result.failed.length || state.apps.length <= 1 || guard++ > 12) break;
      if (state.resizeId) break;
      const victims = state.apps.filter(a => !a.focus && a.id !== state.resizeId).sort((x, y) => x.openedAt - y.openedAt);
      const victim = victims[0] || state.apps[0];
      closeApp(victim.id);
    }

    const m = metrics();
    const px = c => c.x * (m.cw + GAP);
    const py = c => c.y * (m.ch + GAP);
    const pw = c => c.w * m.cw + (c.w - 1) * GAP;
    const ph = c => c.h * m.ch + (c.h - 1) * GAP;

    let maxX = 0;
    result.placed.forEach(p => { maxX = Math.max(maxX, p.x + p.w); });
    const anyPinned = result.placed.some(p => p.pinned);
    const offset = (!anyPinned && maxX) ? Math.max(0, (m.width - (px({ x: maxX, y: 0 }) - GAP)) / 2) : 0;

    const placedIds = new Set(result.placed.map(p => p.id));
    for (const [id, t] of tiles) {
      if (!findApp(id)) {
        tiles.delete(id);
        t.el.classList.add('exit');
        setTimeout(() => t.el.remove(), 340);
      } else if (!placedIds.has(id)) {
        t.el.classList.add('suppressed');
      }
    }

    let entering = 0;
    for (const p of result.placed) {
      const app = findApp(p.id);
      let t = tiles.get(p.id);
      const geo = { left: offset + px(p), top: py(p), width: pw(p), height: ph(p) };
      if (!t) {
        t = createTile(app);
        tiles.set(p.id, t);
        Object.assign(t.el.style, { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px' });
        canvas.appendChild(t.el);
        t.el.classList.add('enter');
        setTimeout(() => t.el.classList.remove('enter'), 30 + entering * 90);
        entering++;
        t.size = p.size; t.w = geo.width; t.h = geo.height;
        t.cellPos = { x: p.x, y: p.y, w: p.w, h: p.h };
        renderTile(app, t);
        paintStatus(p.id);
        paintNarration(p.id);
      } else {
        if (p.id !== state.dragId) {
          Object.assign(t.el.style, { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px' });
        } else {
          Object.assign(t.el.style, { width: geo.width + 'px', height: geo.height + 'px' });
          positionGhost(geo);
        }
        const sizeChanged = t.size !== p.size || Math.abs(t.w - geo.width) > 4 || Math.abs(t.h - geo.height) > 4;
        t.size = p.size; t.w = geo.width; t.h = geo.height;
        t.cellPos = { x: p.x, y: p.y, w: p.w, h: p.h };
        if (sizeChanged || app.dirtyFlag) {
          clearTimeout(t.rr);
          t.rr = setTimeout(() => renderTile(app, t), sizeChanged ? 640 : 0);
        }
      }
      t.el.classList.remove('suppressed');
      t.el.classList.toggle('focus', !!app.focus);
      t.el.querySelector('.tile-size').textContent = app.custom ? `${p.w}×${p.h}` : p.size;
    }
    refreshLauncher();
  }

  function renderTile(app, t, opts = {}) {
    if (!findApp(app.id)) return;
    app.dirtyFlag = false;
    const b = t.body;
    if (opts.instant) {
      // mid-stream repaint: no fade, or the text would flicker on every delta
      const keep = b.scrollTop;
      const pinned = b.scrollHeight - b.clientHeight - keep < 40;
      b.style.transition = 'none';
      b.style.opacity = '1';
      render(app.id, b, app);
      b.scrollTop = pinned ? b.scrollHeight : keep;
      return;
    }
    b.style.transition = 'none';
    b.style.opacity = '0';
    render(app.id, b, app);
    requestAnimationFrame(() => {
      b.style.transition = 'opacity 220ms ease';
      b.style.opacity = '1';
    });
  }

  /* ---- ghost + guides + waves (ported) ---- */
  let ghost = null;
  function ghostEl() {
    if (!ghost) { ghost = document.createElement('div'); ghost.id = 'drop-ghost'; canvas.appendChild(ghost); }
    return ghost;
  }
  function positionGhost(geo) {
    Object.assign(ghostEl().style, { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px', opacity: 1 });
  }

  let rzGuides = null;
  function guideEls() {
    if (!rzGuides) {
      const g = document.createElement('div');
      g.className = 'rz-guide min';
      g.innerHTML = '<span>min</span>';
      const d = document.createElement('div');
      d.id = 'rz-dims';
      canvas.appendChild(g); canvas.appendChild(d);
      rzGuides = { min: g, dims: d };
    }
    return rzGuides;
  }
  function showGuides(app, origin) {
    const g = guideEls();
    const m = metrics();
    const [w, h] = REGISTRY[app.id].sizes.s;
    const x = Math.min(origin.x, GRID.cols - w);
    const y = Math.min(origin.y, GRID.rows - h);
    Object.assign(g.min.style, {
      left: x * (m.cw + GAP) + 'px', top: y * (m.ch + GAP) + 'px',
      width: w * m.cw + (w - 1) * GAP + 'px', height: h * m.ch + (h - 1) * GAP + 'px', opacity: 1,
    });
    Object.assign(g.dims.style, { left: origin.x * (m.cw + GAP) + 4 + 'px', top: origin.y * (m.ch + GAP) - 26 + 'px', opacity: 1 });
    updateDims(app.custom ? app.custom.w : w, app.custom ? app.custom.h : h);
  }
  function updateDims(w, h) { if (rzGuides) rzGuides.dims.textContent = w + ' × ' + h; }
  function hideGuides() { if (rzGuides) { rzGuides.min.style.opacity = 0; rzGuides.dims.style.opacity = 0; } }

  function spawnWaves(el, opts = {}) {
    const parent = canvas.contains(el) ? canvas : stage;
    const pr = parent.getBoundingClientRect();
    const sx = parseFloat(el.style.left), sy = parseFloat(el.style.top);
    const sw = parseFloat(el.style.width), sh = parseFloat(el.style.height);
    const r = el.getBoundingClientRect();
    const cx = Number.isFinite(sx) && Number.isFinite(sw) ? sx + sw / 2 : r.left - pr.left + r.width / 2;
    const cy = Number.isFinite(sy) && Number.isFinite(sh) ? sy + sh / 2 : r.top - pr.top + r.height / 2;
    const base = Math.max(Number.isFinite(sw) ? sw : r.width, Number.isFinite(sh) ? sh : r.height);
    for (let i = 0; i < (opts.rings || 2); i++) {
      setTimeout(() => {
        const w = document.createElement('div');
        w.className = 'wave';
        const D = base + (opts.spread || 150);
        Object.assign(w.style, { left: cx + 'px', top: cy + 'px', width: D + 'px', height: D + 'px' });
        if (opts.color) w.style.setProperty('--wc', opts.color);
        if (opts.dur) w.style.setProperty('--wd', opts.dur + 'ms');
        parent.appendChild(w);
        setTimeout(() => w.remove(), (opts.dur || 560) + 60);
      }, i * 110);
    }
  }
  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    spawnWaves(el, { rings: 2 });
    setTimeout(() => el.classList.remove('shake'), 380);
  }

  function squelchNextClick() {
    const h = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', h, { capture: true, once: true });
    const disarm = () => setTimeout(() => window.removeEventListener('click', h, true), 300);
    window.addEventListener('mouseup', disarm, { once: true });
  }

  /* ---- tile resize & drag (ported: bottom half/corner resize, top half move) ---- */
  function startTileResize(app, t, e, mode) {
    if (e.button !== 0 || e.target.closest('.tbtn')) return;
    e.preventDefault();
    const cur = t.cellPos ? { ...t.cellPos } : { x: 0, y: 0, w: 2, h: 2 };
    const spec = REGISTRY[app.id];
    const minW = spec.sizes.s[0], minH = spec.sizes.s[1];
    const m0 = metrics();
    let started = false, armX = true, armY = true;
    const mv = ev => {
      if (!started) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
        started = true;
        squelchNextClick();
        state.resizeId = app.id;
        app.at = app.at || { x: cur.x, y: cur.y };
        app.custom = app.custom || { w: cur.w, h: cur.h };
        app.userSized = true;
        document.body.classList.add('tiledrag');
        showGuides(app, { x: app.at.x, y: app.at.y });
      }
      const dx = ev.clientX - e.clientX;
      const dy = ev.clientY - e.clientY;
      let w = app.custom.w, h = app.custom.h;
      if (mode !== 'y') {
        const rawW = cur.w + Math.round(dx / (m0.cw + GAP));
        w = Math.max(minW, Math.min(GRID.cols, rawW));
        if (rawW !== w) { if (armX) { shake(t.el); armX = false; } } else armX = true;
      }
      if (mode !== 'x') {
        const rawH = cur.h + Math.round(dy / (m0.ch + GAP));
        h = Math.max(minH, Math.min(GRID.rows, rawH));
        if (rawH !== h) { if (armY) { shake(t.el); armY = false; } } else armY = true;
      }
      if (w !== app.custom.w || h !== app.custom.h) {
        app.custom = { w, h };
        app.touched = ++state.counter;
        app.at = { x: Math.min(app.at.x, GRID.cols - w), y: Math.min(app.at.y, GRID.rows - h) };
        updateDims(w, h);
        relayout();
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      if (!started) return;
      hideGuides();
      state.resizeId = null;
      document.body.classList.remove('tiledrag');
      relayout();
      persistLayout();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  function startTileDrag(app, t, e) {
    if (e.button !== 0 || e.target.closest('.tbtn')) return;
    e.preventDefault();
    const cr = canvas.getBoundingClientRect();
    const r = t.el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const offX = sx - r.left, offY = sy - r.top;
    let started = false, lastCell = null;
    const mv = ev => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
        started = true;
        squelchNextClick();
        state.dragId = app.id;
        state.resizeId = app.id;
        app.custom = app.custom || (t.cellPos ? { w: t.cellPos.w, h: t.cellPos.h } : null);
        app.userSized = true;
        document.body.classList.add('tiledrag');
        t.el.classList.add('drag');
      }
      const x = ev.clientX - cr.left - offX;
      const y = ev.clientY - cr.top - offY;
      t.el.style.left = x + 'px';
      t.el.style.top = y + 'px';
      const m = metrics();
      const cell = { x: Math.max(0, Math.round(x / (m.cw + GAP))), y: Math.max(0, Math.round(y / (m.ch + GAP))) };
      if (!lastCell || cell.x !== lastCell.x || cell.y !== lastCell.y) {
        lastCell = cell;
        app.at = { ...cell };
        relayout();
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      if (!started) return;
      squelchNextClick();
      state.dragId = null;
      state.resizeId = null;
      app.touched = ++state.counter;
      document.body.classList.remove('tiledrag');
      t.el.classList.remove('drag');
      if (ghost) ghost.style.opacity = 0;
      relayout();
      persistLayout();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  function createTile(app) {
    const spec = REGISTRY[app.id];
    const el = document.createElement('div');
    el.className = 'tile';
    el.style.setProperty('--h', spec.hue);
    el.innerHTML = `
      <div class="tile-head">
        <span class="tile-ico">${icon(app.id)}</span>
        <span class="tile-name">${spec.name}</span>
        <span class="tile-size">m</span>
        <div class="tile-actions">
          <button class="tbtn close" data-a="close" title="Close">×</button>
        </div>
      </div>
      <div class="tile-body"></div>`;
    const body = el.querySelector('.tile-body');
    el.querySelector('[data-a=close]').onclick = () => {
      const a = findApp(app.id);
      if (a && a.shownAt && Date.now() - a.shownAt < 15000 && app.id !== 'plan') {
        signal('tile_closed_fast', app.id);
      }
      closeApp(app.id);
      relayout();
      persistLayout();
    };
    el.querySelector('.tile-head').ondblclick = e => {
      if (e.target.closest('.tbtn')) return;
      const a = findApp(app.id);
      if (a) { a.size = 'xl'; setFocus(app.id); relayout(); persistLayout(); }
    };
    el.addEventListener('mousedown', e => {
      setFocus(app.id);
      if (app.id !== 'plan') signal('app_used', app.id);
      for (const [id, tt] of tiles) tt.el.classList.toggle('focus', id === app.id);
      if (e.button !== 0 || e.target.closest('input,textarea,select,button,label')) return;
      const r = el.getBoundingClientRect();
      const ex = r.right - e.clientX, ey = r.bottom - e.clientY;
      const mode = (ex < 22 && ey < 22) ? 'xy'
        : ex < 12 ? 'x'
        : ey < 12 ? 'y'
        : (e.clientY - r.top > r.height / 2) ? 'xy'
        : null;
      if (mode) return startTileResize(app, tRef, e, mode);
      startTileDrag(app, tRef, e);
    });
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--px', e.clientX - r.left + 'px');
      el.style.setProperty('--py', e.clientY - r.top + 'px');
      if (!document.body.classList.contains('tiledrag')) {
        const ex = r.right - e.clientX, ey = r.bottom - e.clientY;
        const corner = ex < 22 && ey < 22;
        el.classList.toggle('rz', corner || (!(ex < 12) && !(ey < 12) && (e.clientY - r.top) > r.height / 2));
        el.classList.toggle('rz-x', !corner && ex < 12);
        el.classList.toggle('rz-y', !corner && !(ex < 12) && ey < 12);
      }
    });
    el.addEventListener('pointerleave', () => el.classList.remove('rz', 'rz-x', 'rz-y'));
    const tRef = { el, body, size: null, w: 0, h: 0 };
    return tRef;
  }

  window.addEventListener('resize', () => relayout());

  /* canvas hover dots */
  const wsEl = document.getElementById('workspace');
  wsEl.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    canvas.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    canvas.style.setProperty('--my', (e.clientY - r.top) + 'px');
    canvas.style.setProperty('--mo', '1');
  });
  wsEl.addEventListener('mouseleave', () => canvas.style.setProperty('--mo', '0'));

  /* ---------------- apps popover ---------------- */
  function refreshLauncher() {
    appsPop.querySelectorAll('.ap-row').forEach(r => r.classList.toggle('on', !!findApp(r.dataset.id)));
  }
  for (const [id, spec] of Object.entries(REGISTRY)) {
    const b = document.createElement('button');
    b.className = 'ap-row';
    b.dataset.id = id;
    b.style.setProperty('--h', spec.hue);
    b.innerHTML = `${icon(id)}<span>${spec.name}</span><i></i>`;
    b.title = spec.desc;
    b.onclick = () => {
      if (findApp(id)) closeApp(id);
      else openApp(id, 'm', true);
      /* The hero covers the whole canvas until the first message, so opening a
         window from here without leaving centre mode gives you a tile that
         exists, renders, and is completely invisible. */
      if (state.apps.length) {
        document.body.classList.remove('chat-center');
        Chat.tuck(true);
      } else if (!document.body.classList.contains('has-msgs')) {
        document.body.classList.add('chat-center');   // emptied it again — the invitation comes back
        Chat.tuck(false);
      }
      relayout();
      persistLayout();
    };
    appsPop.appendChild(b);
  }
  document.getElementById('apps-btn').onclick = e => {
    e.stopPropagation();
    document.getElementById('appsmenu').classList.toggle('open');
  };

  /* ---------------- suggestions (hero) ---------------- */
  /* Two of these are one-shot asks and two are pieces of work. The mix is the
     point: the entry screen must not imply that everything here becomes a
     course. */
  const SUGGESTIONS = [
    { t: 'Summarise this for me — I\'ll paste it', i: 'sources' },
    { t: 'Draft a reply declining a meeting', i: 'lesson' },
    { t: 'Teach me how neural networks actually work', i: 'plan' },
    { t: 'I want to get good at personal finance', i: 'quiz' },
  ];
  const sugEl = document.getElementById('suggestions');
  SUGGESTIONS.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug';
    b.style.setProperty('--h', (REGISTRY[s.i] || {}).hue || 215);
    b.innerHTML = `${icon(s.i)}<span></span>`;
    b.querySelector('span').textContent = s.t;
    b.onclick = () => Chat.send(s.t, 'chat');
    sugEl.appendChild(b);
  });

  /* ---------------- in-app UI events → agent ---------------- */
  document.addEventListener('chameleon:event', e => {
    const d = e.detail || {};
    if (d.desc) Chat.sendEvent(d.desc, d.label || 'Clicked', d.icon);
  });

  /* A small handle for the browser tests (and for debugging a live session):
     read-only views of what the client currently believes. */
  window.__cham = {
    sessionId: () => state.sessionId,
    profile: () => state.profile,
    plan: () => state.plan,
    open: () => state.apps.map(a => a.id),
    trace: () => trace.slice(),
    repaintPlan: () => paintPlan(),
    planPlace: () => (state.profile || {}).planPlace,
    endTurn: () => enqueue({ t: '_end' }),
  };

  relayout();
  paintPlan();          // the spine, wherever this learner keeps it
  document.getElementById('chat-input').focus();
})();
