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
  };
  const tiles = new Map();

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

  /* ---------------- boot ---------------- */
  const params = new URLSearchParams(location.search);
  const boot = await api('api/state' + (params.has('session') ? `?session=${params.get('session')}` : ''));
  state.sessionId = boot.session.id;
  state.plan = boot.plan;
  state.sources = boot.sources;
  state.artifacts = boot.artifacts;
  state.tts = boot.tts;
  for (const a of boot.artifacts) state.currentArt[a.app] = a.id; // listed oldest→newest; last wins

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
    api,
    sourceAdded: src => { state.sources.push(src); dirty('sources'); },
    sourceRemoved: id => { state.sources = state.sources.filter(s => s.id !== id); dirty('sources'); },
  });

  Chat.configure({
    sessionId: () => state.sessionId,
    onEvent: ev => enqueue(ev),
    onTurnDone: () => { enqueue({ t: '_end' }); },
    onPlaceChange: () => relayout(), // the canvas reclaims/yields the docked column
  });
  Chat.renderHistory(boot.messages); // also owns the chat-center / fused classes

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
  document.addEventListener('click', e => {
    if (!e.target.closest('#sessmenu')) document.getElementById('sessmenu').classList.remove('open');
    if (!e.target.closest('#appsmenu')) document.getElementById('appsmenu').classList.remove('open');
  });

  /* ---------------- workspace state ops ---------------- */
  const findApp = id => state.apps.find(a => a.id === id);

  function openApp(id, size, focus) {
    if (!REGISTRY[id]) return null;
    let app = findApp(id);
    if (app) { if (size) app.size = size; }
    else {
      app = { id, size: size || 'm', focus: false, openedAt: ++state.counter, ui: null };
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

  /* ---------------- the one-at-a-time action queue ---------------- */
  const queue = [];
  let playing = false;
  let fast = false;

  function enqueue(ev) {
    /* Commandment 7: showing what's happening RIGHT NOW never waits in line
       behind the pacing queue — these are a live view of the current step,
       not a new step competing for attention. */
    if (ev.t === 'tool_start') { beginDrafting(ev); return; }
    if (ev.t === 'draft') { applyDraft(ev); return; }
    queue.push(ev);
    if (!playing) playQueue();
  }

  function beginDrafting(ev) {
    if (ev.status) setStatus(ev.app, ev.status);
    if (!ev.app) return;
    state.draft = { app: ev.app, field: ev.field || null, items: [] };
    document.body.classList.add('acting');
    // open the tile FIRST so the content has somewhere visible to land
    applyAction({ type: 'open', app: ev.app, size: ev.size || 'm', focus: true });
  }

  /* Each draft event is a full snapshot — the trailing item grows as its text
     arrives. Repaint on an animation frame so a fast stream stays smooth. */
  let draftRaf = 0;
  function applyDraft(ev) {
    state.draft = { app: ev.app, field: ev.field, head: ev.head || {}, items: ev.items || [] };
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
    while (queue.length) {
      const ev = queue.shift();
      if (ev.t === '_end') {
        fast = false;
        state.draft = null;
        clearStatus();
        document.body.classList.remove('acting');
        Chat.turnSettled();
        continue;
      }
      document.body.classList.add('acting'); // history yields to the workspace
      playStep(ev);
      await sleep(ev.t === 'narrate' ? 1500 : 700);
    }
    playing = false;
  }
  // A pressed stop fast-forwards what already arrived so client and server
  // state stay in sync — stopping aborts the agent, not the bookkeeping.
  window.addEventListener('chameleon:stopped', () => { fast = true; });

  function playStep(ev) {
    switch (ev.t) {
      case 'action': applyAction(ev.a); break;
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
        dirty('plan');
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
        if (t) spawnWaves(t.el, { rings: 1, spread: 110, dur: 720, color: `hsl(${REGISTRY[a.app].hue} 85% 68% / 0.5)` });
      }, 80);
    }
  }

  /* narration bubble inside the app window (commandment 3) */
  function narrateInTile(appId, text) {
    const t = tiles.get(appId);
    if (!t) return;
    t.el.querySelector('.tile-narr')?.remove();
    const n = document.createElement('div');
    n.className = 'tile-narr';
    n.innerHTML = `<img src="chameleon.png" alt=""><span></span>`;
    t.el.appendChild(n);
    const span = n.querySelector('span');
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 40));
    const id = setInterval(() => {
      i += step;
      span.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(id);
    }, 24);
    setTimeout(() => { n.classList.add('out'); setTimeout(() => n.remove(), 400); }, 2600 + text.length * 28);
  }

  /* ---------------- layout + tile DOM (carried from the POC) ---------------- */
  const DOCK_W = 400; // keep in sync with --dock-side-w in style.css
  function metrics() {
    const r = stage.getBoundingClientRect();
    const centered = document.body.classList.contains('chat-center');
    const place = Chat.place();
    let width = r.width - 28;
    let height = r.height - 28;
    if (!centered) {
      // a side dock takes its own column; the centre dock reserves a bottom strip
      if (place === 'left' || place === 'right') width -= DOCK_W + 12;
      else if (place !== 'mini') height -= 92;
      else height -= 26;
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
    el.querySelector('[data-a=close]').onclick = () => { closeApp(app.id); relayout(); persistLayout(); };
    el.querySelector('.tile-head').ondblclick = e => {
      if (e.target.closest('.tbtn')) return;
      const a = findApp(app.id);
      if (a) { a.size = 'xl'; setFocus(app.id); relayout(); persistLayout(); }
    };
    el.addEventListener('mousedown', e => {
      setFocus(app.id);
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
  const SUGGESTIONS = [
    { t: 'Teach me how neural networks actually work', i: 'lesson' },
    { t: 'Help me prep for my exam — I\'ll paste my notes', i: 'sources' },
    { t: 'I want to get good at personal finance', i: 'plan' },
    { t: 'Quiz me on something I should know', i: 'quiz' },
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

  relayout();
  document.getElementById('chat-input').focus();
})();
