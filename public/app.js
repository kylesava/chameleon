/* Chameleon orchestrator: workspace state, tile animation, morphing chat, CRM context + agent actions. */
(async () => {
  const { REGISTRY, icon, render } = Apps;
  const GRID = Layout.GRID;
  const GAP = 15;
  const SIZE_ORDER = Layout.SIZE_ORDER;

  const stage = document.getElementById('stage');
  const canvas = document.getElementById('canvas');
  const ucEl = document.getElementById('usecases');
  const appsPop = document.getElementById('apps-pop');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const sugEl = document.getElementById('suggestions');
  const chatpane = document.getElementById('chatpane');

  const CHAT_W = { slim: 310, normal: 400, wide: 600 };

  const state = {
    apps: [],            // { id, size, focus, openedAt, data, ui }
    history: [],         // { role, content }
    busy: false,
    counter: 0,
    chatMode: 'float',   // dock | float | mini
    chatPrev: 'float',
    dockSide: 'right',   // right | left | bottom
    chatPx: CHAT_W.normal,
    dragId: null,
    resizeId: null,
    ctx: { account: null, opp: null },
  };
  const tiles = new Map(); // id -> { el, body, size, w, h }

  const params = new URLSearchParams(location.search);
  if (params.has('snap')) document.body.classList.add('snap');

  /* ---------------- CRM + context ---------------- */

  let CRMD = null;
  // relative path so the app works when hosted under a sub-path (e.g. /cmln/)
  try { CRMD = await (await fetch('api/crm')).json(); } catch { /* offline: apps fall back to defaults */ }

  const acctOf = id => CRMD && CRMD.accounts.find(a => a.id === id);
  const oppOf = id => {
    if (!CRMD) return null;
    for (const a of CRMD.accounts) { const o = a.opps.find(x => x.id === id); if (o) return { a, o }; }
    return null;
  };
  function ctxLabel() {
    const a = state.ctx.account && acctOf(state.ctx.account);
    if (!a) return 'All accounts';
    const f = state.ctx.opp && oppOf(state.ctx.opp);
    return f ? `${a.name} · ${f.o.name}` : a.name;
  }

  function setContext(accountId, oppId, opts = {}) {
    if (oppId) { const f = oppOf(oppId); if (f) accountId = f.a.id; else oppId = null; }
    if (accountId && !acctOf(accountId)) accountId = null;
    const changed = state.ctx.account !== (accountId || null) || state.ctx.opp !== (oppId || null);
    state.ctx = { account: accountId || null, opp: oppId || null };
    updateCtxBar();
    if (!changed) return;
    for (const id of ['relationships', 'accountplan', 'pricing', 'notes', 'territory', 'pipeline', 'oppmap', 'battlecard', 'oppcard', 'callreview', 'flashcards']) {
      if (id === opts.skip) continue;
      const ap = findApp(id);
      if (!ap) continue;
      const groupBy = id === 'territory' ? ap.data.groupBy : null;
      ap.data = groupBy ? { groupBy } : {};
      ap.ui = null;
      ap.dirty = true;
    }
    relayout();
    if (!opts.quiet) note(`Context → ${ctxLabel()}`);
  }

  function selectContext(accountId, oppId, opts = {}) {
    setContext(accountId, oppId, { quiet: !!opts.emitDesc, skip: opts.skip });
    if (opts.emitDesc) uiEvent(opts.emitDesc, opts.emitLabel || 'Selected', opts.emitIcon, opts.emitRoute || null);
  }

  /* top-bar context pills */
  const ctxbar = document.getElementById('ctxbar');
  function menuRowsAccount() {
    return `<button class="cm-row" data-a="">◌ All accounts</button>` + CRMD.accounts.map(a =>
      `<button class="cm-row" data-a="${a.id}"><i class="hdot ${a.health}"></i><b>${a.name}</b><span>${a.arr ? '$' + (a.arr / 1000).toFixed(1) + 'M ARR' : 'new logo'}</span></button>`).join('');
  }
  function menuRowsOpp() {
    const a = state.ctx.account && acctOf(state.ctx.account);
    const rows = a ? a.opps.map(o => ({ a, o })) : CRMD.accounts.flatMap(x => x.opps.map(o => ({ a: x, o })));
    return `<button class="cm-row" data-o="">◌ No opportunity</button>` + rows.map(({ a: aa, o }) =>
      `<button class="cm-row" data-o="${o.id}"><i class="hdot ${o.health}"></i><b>${o.name}</b><span>${a ? o.stage : aa.name} · $${o.value}K</span></button>`).join('');
  }
  function buildCtxBar() {
    if (!CRMD || !ctxbar) return;
    ctxbar.innerHTML = `
      <div class="ctxp" id="ctxp-a"><span>Account</span><b>All accounts</b>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6.5L8 10l4-3.5"/></svg>
        <div class="ctxmenu"></div></div>
      <div class="ctxp" id="ctxp-o"><span>Opportunity</span><b>—</b>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6.5L8 10l4-3.5"/></svg>
        <div class="ctxmenu"></div></div>`;
    ctxbar.querySelectorAll('.ctxp').forEach(p => {
      p.addEventListener('click', e => {
        if (e.target.closest('.cm-row')) return;
        const was = p.classList.contains('open');
        ctxbar.querySelectorAll('.ctxp').forEach(x => x.classList.remove('open'));
        if (!was) p.classList.add('open');
      });
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.ctxp')) ctxbar.querySelectorAll('.ctxp').forEach(x => x.classList.remove('open'));
    });
    updateCtxBar();
  }
  function updateCtxBar() {
    if (!CRMD || !ctxbar || !ctxbar.firstElementChild) return;
    const pa = document.getElementById('ctxp-a'), po = document.getElementById('ctxp-o');
    const a = state.ctx.account && acctOf(state.ctx.account);
    const f = state.ctx.opp && oppOf(state.ctx.opp);
    pa.querySelector('b').textContent = a ? a.name : 'All accounts';
    po.querySelector('b').textContent = f ? f.o.name : '—';
    pa.classList.toggle('set', !!a);
    po.classList.toggle('set', !!f);
    pa.querySelector('.ctxmenu').innerHTML = menuRowsAccount();
    po.querySelector('.ctxmenu').innerHTML = menuRowsOpp();
    pa.querySelectorAll('.cm-row').forEach(b => b.onclick = () => {
      ctxbar.querySelectorAll('.ctxp').forEach(x => x.classList.remove('open'));
      const id = b.dataset.a || null;
      setContext(id, null, { quiet: true });
      uiEvent(`switched context to ${id ? acctOf(id).name : 'all accounts'} using the context switcher. Open tiles auto-refreshed from CRM. Adjust the workspace for this context and give a one-line read.`,
        `Context · ${id ? acctOf(id).name : 'All accounts'}`, 'accountplan', { key: `acctswitch:${id || 'none'}` });
    });
    po.querySelectorAll('.cm-row').forEach(b => b.onclick = () => {
      ctxbar.querySelectorAll('.ctxp').forEach(x => x.classList.remove('open'));
      const id = b.dataset.o || null;
      setContext(id ? null : state.ctx.account, id, { quiet: true });
      const ff = id && oppOf(id);
      uiEvent(ff
        ? `switched context to the "${ff.o.name}" opportunity on ${ff.a.name} ($${ff.o.value}K, ${ff.o.stage}, close ${ff.o.close}) using the context switcher. Adjust the workspace to move this deal and give a one-line read.`
        : `cleared the opportunity context (now: ${ctxLabel()}). Adjust if needed.`,
        `Context · ${ff ? ff.o.name : 'no opportunity'}`, 'pipeline', { key: `oppswitch:${id || 'none'}` });
    });
  }

  /* ---------------- chat pane modes ---------------- */

  function applyChatMode(mode, px) {
    const sides = { dock: 'right', right: 'right', left: 'left', bottom: 'bottom' };
    if (mode === 'mini' || mode === 'float') {
      if (mode === 'float') state.chatPrev = 'float';
      state.chatMode = mode;
      if (px) state.chatPx = px;
    } else if (sides[mode]) {
      state.chatMode = 'dock';
      state.dockSide = sides[mode];
      state.chatPrev = sides[mode] === 'bottom' ? 'bottom' : 'dock';
      if (px) state.chatPx = px;
    } else if (CHAT_W[mode]) { // legacy slim/normal/wide → dock at that width
      state.chatMode = 'dock';
      state.chatPrev = 'dock';
      state.chatPx = CHAT_W[mode];
    } else return;
    state.chatManualH = false; // mode changes reclaim auto-sizing
    document.documentElement.style.setProperty('--chat-w', state.chatPx + 'px');
    const dock = state.chatMode === 'dock';
    document.body.classList.toggle('chat-mini', state.chatMode === 'mini');
    document.body.classList.toggle('chat-float', state.chatMode === 'float');
    document.body.classList.toggle('dock-left', dock && state.dockSide === 'left');
    const isBottom = dock && state.dockSide === 'bottom';
    document.body.classList.toggle('dock-bottom', isBottom);
    /* bottom composer ⇔ transcript lives as its own tile */
    if (isBottom && !findApp('convo')) openApp('convo', 'm', null, false);
    if (!isBottom && findApp('convo')) closeApp('convo');
    if (typeof fitChat === 'function') fitChat();
  }

  /* a drag consumed this gesture — swallow the click that follows the release,
     however long the drag lasted */
  function squelchNextClick() {
    const h = ev => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', h, { capture: true, once: true });
    const disarm = () => setTimeout(() => window.removeEventListener('click', h, true), 300);
    window.addEventListener('mouseup', disarm, { once: true });
  }

  /* dock/minimize drop-zones for the floating chat */
  const zones = {};
  for (const [id, label] of [['right', 'Dock right'], ['left', 'Dock left'], ['bottom', 'Dock bottom'], ['mini', 'Minimize']]) {
    const z = document.createElement('div');
    z.className = 'zone'; z.id = 'zone-' + id; z.textContent = label;
    stage.appendChild(z);
    zones[id] = z;
  }

  /* the chat is ALWAYS draggable (any mode, any non-interactive spot):
     lift → it becomes a floating card under your cursor; far edges dock it,
     bottom-middle bars it, bottom-right corner minimizes it, anywhere else it floats. */
  chatpane.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (document.body.classList.contains('chat-center')) return;
    /* floating card: grab the bottom half to RESIZE (even over the transcript),
       top half to MOVE */
    if (state.chatMode === 'float') {
      const pr0 = chatpane.getBoundingClientRect();
      if (e.clientY - pr0.top > pr0.height / 2) {
        if (e.target.closest('input,textarea,button')) return;
        return beginChatResize(e, pr0);
      }
    }
    if (e.target.closest('input,textarea,button,.sug,.msg,#chat-log,#chat-drag')) return;
    const sr = stage.getBoundingClientRect();
    let moved = false, curZone = null;
    let offX = Math.min(e.clientX - chatpane.getBoundingClientRect().left, 340);
    let offY = Math.min(e.clientY - chatpane.getBoundingClientRect().top, 30);
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) return;
      if (!moved) {
        moved = true;
        squelchNextClick();
        document.body.classList.add('dragging', 'chatzones');
        if (state.chatMode !== 'float') { applyChatMode('float'); offX = 170; offY = 23; }
        document.body.classList.add('chat-placed');
        relayout(); // workspace reclaims any dock column immediately
      }
      const pr = chatpane.getBoundingClientRect();
      // overshoot allowed: the card may leave the stage so the cursor can reach the zones
      const x = Math.max(-(pr.width - 90), Math.min(sr.width - 90, ev.clientX - sr.left - offX));
      const y = Math.max(-10, Math.min(sr.height - 42, ev.clientY - sr.top - offY));
      chatpane.style.setProperty('--fx', x + 'px');
      chatpane.style.setProperty('--fy', y + 'px');
      const zx = ev.clientX - sr.left, zy = ev.clientY - sr.top;
      // the corner owns minimize — it wins over the right rail
      curZone = (zy > sr.height - 125 && zx > sr.width - 400) ? 'mini'
        : zx > sr.width - 195 ? 'right'
        : zx < 195 ? 'left'
        : (zy > sr.height - 155 && zx > sr.width * 0.2 && zx < sr.width * 0.8) ? 'bottom'
        : null;
      for (const k in zones) zones[k].classList.toggle('arm', curZone === k);
    };
    const up = () => {
      document.body.classList.remove('dragging', 'chatzones');
      for (const k in zones) zones[k].classList.remove('arm');
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      if (!moved) return;
      if (curZone) {
        document.body.classList.remove('chat-placed');
        applyChatMode(curZone);
      } else {
        // rest fully on-stage: spring back from any overshoot
        requestAnimationFrame(() => {
          const pr2 = chatpane.getBoundingClientRect();
          const cx = Math.max(8, Math.min(sr.width - pr2.width - 8, parseFloat(chatpane.style.getPropertyValue('--fx')) || 0));
          const cy = Math.max(8, Math.min(sr.height - pr2.height - 8, parseFloat(chatpane.style.getPropertyValue('--fy')) || 0));
          chatpane.style.setProperty('--fx', cx + 'px');
          chatpane.style.setProperty('--fy', cy + 'px');
        });
      }
      relayout();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });

  function beginChatResize(e, pr0) {
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    let started = false, chatShakeArmed = true;
    const mv = ev => {
      if (!started) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        started = true;
        squelchNextClick();
        document.body.classList.add('dragging');
      }
      const rawW = ev.clientX - pr0.left;
      const rawH = ev.clientY - pr0.top;
      const maxH = sr.height * 0.86;
      const w = Math.max(300, Math.min(680, rawW));
      const h = Math.max(170, Math.min(maxH, rawH));
      const over = rawW < 240 || rawW > 740 || rawH < 110 || rawH > maxH + 60;
      if (over) { if (chatShakeArmed) { shake(chatpane); chatShakeArmed = false; } }
      else chatShakeArmed = true;
      chatpane.style.setProperty('--chat-fw', w + 'px');
      chatpane.style.setProperty('--chat-h', h + 'px');
      state.chatManualH = true;
    };
    const up = () => {
      document.body.classList.remove('dragging');
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  /* mini pill: click to reopen */
  document.getElementById('chat-head').addEventListener('click', e => {
    if (state.chatMode === 'mini' && !e.target.closest('input,button')) {
      applyChatMode(state.chatPrev || 'float');
      relayout();
    }
  });

  /* spotlight tracking + resize-cursor hint on the chat card */
  chatpane.addEventListener('pointermove', e => {
    const r = chatpane.getBoundingClientRect();
    chatpane.style.setProperty('--px', e.clientX - r.left + 'px');
    chatpane.style.setProperty('--py', e.clientY - r.top + 'px');
    chatpane.classList.toggle('rz', state.chatMode === 'float' && (e.clientY - r.top) > r.height / 2 && !e.target.closest('input,button,.sug,.msg'));
  });
  chatpane.addEventListener('pointerleave', () => chatpane.classList.remove('rz'));

  // drag-to-resize
  const dragEl = document.getElementById('chat-drag');
  dragEl.addEventListener('mousedown', e => {
    e.preventDefault();
    document.body.classList.add('dragging');
    const move = ev => {
      const px = Math.max(280, Math.min(660, window.innerWidth - ev.clientX - 14));
      applyChatMode('normal', px);
      requestAnimationFrame(() => relayout());
    };
    const up = () => {
      document.body.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      relayout();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  chatpane.addEventListener('transitionend', e => {
    if (e.target === chatpane && (e.propertyName === 'width' || e.propertyName === 'right')) relayout();
  });

  /* ---------------- workspace state ops ---------------- */

  const findApp = id => state.apps.find(a => a.id === id);

  function openApp(id, size, data, focus) {
    if (!REGISTRY[id]) return null;
    let app = findApp(id);
    if (app) {
      if (size) app.size = size;
      if (data && Object.keys(data).length) { app.data = { ...app.data, ...data }; app.ui = null; app.dirty = true; }
    } else {
      app = { id, size: size || 'm', focus: false, openedAt: ++state.counter, data: data || {}, ui: null };
      state.apps.push(app);
    }
    if (focus) setFocus(id);
    return app;
  }

  function closeApp(id) {
    const i = state.apps.findIndex(a => a.id === id);
    if (i >= 0) state.apps.splice(i, 1);
  }

  function setFocus(id) {
    state.apps.forEach(a => a.focus = a.id === id);
  }

  function applyActions(actions) {
    const applied = [];
    const opened = [];
    let explicitFocus = false;
    for (const a of actions || []) {
      const app = a.app;
      switch (a.type) {
        case 'open':
          if (REGISTRY[app]) {
            openApp(app, a.size || 'm', a.data, a.focus === true);
            const apRef = findApp(app);
            if (apRef) { delete apRef.at; delete apRef.custom; apRef.userSized = false; } // agent placement wins
            if (a.focus === true) explicitFocus = true;
            opened.push({ app, size: a.size || 'm' });
            applied.push({ ...a });
          }
          break;
        case 'close':
          if (findApp(app)) { closeApp(app); applied.push({ ...a }); }
          break;
        case 'resize':
          if (findApp(app) && SIZE_ORDER.includes(a.size)) {
            const apRef = findApp(app);
            apRef.size = a.size;
            apRef.userSized = false;
            delete apRef.custom;
            applied.push({ ...a });
          }
          break;
        case 'focus':
          if (findApp(app)) { setFocus(app); explicitFocus = true; applied.push({ ...a }); }
          break;
        case 'close_all':
          if (state.apps.length) { state.apps.length = 0; applied.push({ ...a }); }
          break;
        case 'chat':
          if (['slim', 'normal', 'wide', 'mini'].includes(a.mode)) { applyChatMode(a.mode); applied.push({ ...a }); }
          break;
        case 'context': {
          const acc = a.account && a.account !== 'none' ? a.account : null;
          const opp = a.opportunity && a.opportunity !== 'none' ? a.opportunity : null;
          setContext(acc, opp, { quiet: true });
          applied.push({ ...a });
          break;
        }
      }
    }
    if (!explicitFocus && opened.length) {
      const best = [...opened].sort((a, b) => SIZE_ORDER.indexOf(b.size) - SIZE_ORDER.indexOf(a.size))[0];
      if (findApp(best.app)) setFocus(best.app);
    }
    relayout();
    /* the AI just reshaped these — announce with a single hue-tinted ring */
    const touched = applied.filter(x => (x.type === 'open' || x.type === 'resize') && REGISTRY[x.app]);
    if (touched.length) setTimeout(() => {
      touched.forEach((x, i) => {
        const t = tiles.get(x.app);
        if (t) setTimeout(() => spawnWaves(t.el, {
          rings: 1, spread: 110, dur: 720,
          color: `hsl(${REGISTRY[x.app].hue} 85% 68% / 0.5)`,
        }), i * 90);
      });
    }, 80);
    return applied;
  }

  /* ---------------- layout + tile DOM ---------------- */

  function metrics() {
    // compute against *target* geometry so tiles animate to their final home
    // even while the chat pane is mid-transition
    const r = stage.getBoundingClientRect();
    const centered = document.body.classList.contains('chat-center');
    let width = r.width - 28;
    let height = r.height - 28;
    if (!centered) {
      if (state.chatMode === 'dock') {
        if (state.dockSide === 'bottom') height -= 148;
        else width -= state.chatPx + 12;
      }
    }
    return {
      cw: (width - GAP * (GRID.cols - 1)) / GRID.cols,
      ch: (height - GAP * (GRID.rows - 1)) / GRID.rows,
      width,
    };
  }

  function relayout() {
    /* conversation-as-tile ⇔ bottom composer stay in lockstep (before solving) */
    {
      const convoOpen = !!findApp('convo');
      const isBottom = state.chatMode === 'dock' && state.dockSide === 'bottom';
      if (convoOpen && !isBottom) applyChatMode('bottom');
      else if (!convoOpen && isBottom) applyChatMode(state.chatPrev !== 'bottom' ? (state.chatPrev || 'float') : 'float');
      document.body.classList.toggle('convo-out', !!findApp('convo'));
      if (!findApp('convo') && log.parentElement !== chatpane) chatpane.insertBefore(log, sugEl);
    }

    document.body.classList.toggle('chat-center', state.apps.length === 0);

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
      if (state.resizeId) break; // live pull: losers ghost out instead of closing
      const victims = state.apps.filter(a => !a.focus && a.id !== state.resizeId).sort((x, y) => x.openedAt - y.openedAt);
      const victim = victims[0] || state.apps[0];
      closeApp(victim.id);
      note(`Tucked away ${REGISTRY[victim.id].name} to make room`);
    }

    const m = metrics();
    const px = c => c.x * (m.cw + GAP);
    const py = c => c.y * (m.ch + GAP);
    const pw = c => c.w * m.cw + (c.w - 1) * GAP;
    const ph = c => c.h * m.ch + (c.h - 1) * GAP;

    let maxX = 0;
    result.placed.forEach(p => { maxX = Math.max(maxX, p.x + p.w); });
    // auto-centering is a nicety for AI layouts only — the moment the user has
    // pinned anything, cells are absolute and corners mean corners
    const anyPinned = result.placed.some(p => p.pinned);
    const offset = (!anyPinned && maxX) ? Math.max(0, (m.width - (px({ x: maxX, y: 0 }) - GAP)) / 2) : 0;

    const placedIds = new Set(result.placed.map(p => p.id));

    for (const [id, t] of tiles) {
      if (!findApp(id)) {
        tiles.delete(id);
        t.el.classList.add('exit');
        setTimeout(() => t.el.remove(), 340);
      } else if (!placedIds.has(id)) {
        // only possible mid-resize: squeezed out for now, back if you ease off
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
        if (p.id === state.dragId) { /* shouldn't happen */ }
        if (!document.body.classList.contains('snap')) {
          t.el.classList.add('enter');
          setTimeout(() => t.el.classList.remove('enter'), 30 + entering * 90);
          entering++;
        }
        t.size = p.size; t.w = geo.width; t.h = geo.height;
        t.cellPos = { x: p.x, y: p.y, w: p.w, h: p.h };
        renderTile(app, t, p.size);
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
        if (sizeChanged || app.dirty) {
          clearTimeout(t.rr);
          t.rr = setTimeout(() => renderTile(app, t, p.size),
            (!sizeChanged || document.body.classList.contains('snap')) ? 0 : 640);
        }
      }
      t.el.classList.remove('suppressed');
      t.el.classList.toggle('focus', !!app.focus);
      t.el.querySelector('.tile-size').textContent = app.custom ? `${p.w}×${p.h}` : p.size;
    }

    refreshLauncher();
    fitChat();
  }

  function renderTile(app, t, size) {
    if (!findApp(app.id)) return;
    app.dirty = false;
    const b = t.body;
    b.style.transition = 'none';
    b.style.opacity = '0';
    render(app.id, b, app, size);
    requestAnimationFrame(() => {
      b.style.transition = 'opacity 220ms ease';
      b.style.opacity = '1';
    });
  }

  /* ---------------- tile drag & drop ---------------- */

  let ghost = null;
  function ghostEl() {
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.id = 'drop-ghost';
      canvas.appendChild(ghost);
    }
    return ghost;
  }
  function positionGhost(geo) {
    const g = ghostEl();
    Object.assign(g.style, { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px', opacity: 1 });
  }

  /* MIN footprint guide + live W×H readout while resizing */
  let rzGuides = null;
  function guideEls() {
    if (!rzGuides) {
      const g = document.createElement('div');
      g.className = 'rz-guide min';
      g.innerHTML = '<span>min</span>';
      const d = document.createElement('div');
      d.id = 'rz-dims';
      canvas.appendChild(g);
      canvas.appendChild(d);
      rzGuides = { min: g, dims: d };
    }
    return rzGuides;
  }
  function showGuides(app, origin) {
    const g = guideEls();
    const m = metrics();
    const [w, h] = REGISTRY[app.id].sizes.s;
    const x = Math.min(origin.x, Layout.GRID.cols - w);
    const y = Math.min(origin.y, Layout.GRID.rows - h);
    Object.assign(g.min.style, {
      left: x * (m.cw + GAP) + 'px',
      top: y * (m.ch + GAP) + 'px',
      width: w * m.cw + (w - 1) * GAP + 'px',
      height: h * m.ch + (h - 1) * GAP + 'px',
      opacity: 1,
    });
    Object.assign(g.dims.style, {
      left: origin.x * (m.cw + GAP) + 4 + 'px',
      top: origin.y * (m.ch + GAP) - 26 + 'px',
      opacity: 1,
    });
    updateDims(app.custom ? app.custom.w : w, app.custom ? app.custom.h : h);
  }
  function updateDims(w, h) {
    if (rzGuides) rzGuides.dims.textContent = w + ' × ' + h;
  }
  function hideGuides() {
    if (rzGuides) { rzGuides.min.style.opacity = 0; rzGuides.dims.style.opacity = 0; }
  }

  /* sonar rings emitted from an element's (target) center */
  function spawnWaves(el, opts = {}) {
    const parent = canvas.contains(el) ? canvas : stage;
    const pr = parent.getBoundingClientRect();
    // use style targets so rings center on where the tile is HEADED, not mid-flight
    const sx = parseFloat(el.style.left), sy = parseFloat(el.style.top);
    const sw = parseFloat(el.style.width), sh = parseFloat(el.style.height);
    const r = el.getBoundingClientRect();
    const cx = Number.isFinite(sx) && Number.isFinite(sw) ? sx + sw / 2 : r.left - pr.left + r.width / 2;
    const cy = Number.isFinite(sy) && Number.isFinite(sh) ? sy + sh / 2 : r.top - pr.top + r.height / 2;
    const base = Math.max(Number.isFinite(sw) ? sw : r.width, Number.isFinite(sh) ? sh : r.height);
    const rings = opts.rings || 2;
    for (let i = 0; i < rings; i++) {
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

  /* free-form resize — the user's dims are law:
     bottom half & corner pull BOTH axes, right edge = width only,
     bottom edge = height only. Per-cell steps, bounded by min-size and the grid. */
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
        w = Math.max(minW, Math.min(Layout.GRID.cols, rawW));
        if (rawW !== w) { if (armX) { shake(t.el); armX = false; } } else armX = true;
      }
      if (mode !== 'x') {
        const rawH = cur.h + Math.round(dy / (m0.ch + GAP));
        h = Math.max(minH, Math.min(Layout.GRID.rows, rawH));
        if (rawH !== h) { if (armY) { shake(t.el); armY = false; } } else armY = true;
      }
      if (w !== app.custom.w || h !== app.custom.h) {
        app.custom = { w, h };
        app.touched = ++state.counter;
        app.at = {
          x: Math.min(app.at.x, Layout.GRID.cols - w),
          y: Math.min(app.at.y, Layout.GRID.rows - h),
        };
        updateDims(w, h);
        relayout(); // neighbors bend / ghost live
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      if (!started) return;
      hideGuides();
      state.resizeId = null; // final pass: still-squeezed tiles tuck for real
      document.body.classList.remove('tiledrag');
      relayout();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }

  function startTileDrag(app, t, e) {
    if (e.button !== 0 || e.target.closest('.tbtn')) return;
    e.preventDefault(); // no text selection while dragging
    const cr = canvas.getBoundingClientRect();
    const r = t.el.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const offX = sx - r.left, offY = sy - r.top;
    const origin = t.cellPos ? { ...t.cellPos } : null;
    let started = false, lastCell = null, lastX = sx, lastY = sy;
    const mv = ev => {
      lastX = ev.clientX; lastY = ev.clientY;
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 7) return;
        started = true;
        squelchNextClick();
        state.dragId = app.id;
        state.resizeId = app.id; // hold semantics: exact footprint, others bend/ghost
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
        relayout(); // live reflow around the ghost slot
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      if (!started) return;
      squelchNextClick();
      state.dragId = null;
      state.resizeId = null;
      app.touched = ++state.counter; // where you dropped it is where it lives
      document.body.classList.remove('tiledrag');
      t.el.classList.remove('drag');
      if (ghost) ghost.style.opacity = 0;
      relayout(); // springs into the slot; still-squeezed tiles tuck for real
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
    el.querySelector('[data-a=close]').onclick = () => { closeApp(app.id); relayout(); };
    el.querySelector('.tile-head').ondblclick = e => {
      if (e.target.closest('.tbtn')) return;
      const a = findApp(app.id);
      if (a) { a.size = 'xl'; setFocus(app.id); relayout(); }
    };
    // drag starts from ANYWHERE on the tile; clicks (<7px) pass through untouched,
    // and a real drag squelches the click so widgets never mis-fire
    // top half = move, bottom half = resize — from anywhere on the tile
    el.addEventListener('mousedown', e => {
      setFocus(app.id); relayoutSoft();
      if (e.button !== 0 || e.target.closest('input,textarea,select')) return;
      const r = el.getBoundingClientRect();
      const ex = r.right - e.clientX, ey = r.bottom - e.clientY;
      const mode = (ex < 22 && ey < 22) ? 'xy'      // corner → both axes
        : ex < 12 ? 'x'                             // right edge → width only
        : ey < 12 ? 'y'                             // bottom edge → height only
        : (e.clientY - r.top > r.height / 2) ? 'xy' // lower half → both
        : null;
      if (mode) return startTileResize(app, tRef, e, mode);
      if (e.target.closest('#chat-log')) return; // transcript top-half stays selectable
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

  function relayoutSoft() {
    for (const [id, t] of tiles) t.el.classList.toggle('focus', !!(findApp(id) || {}).focus);
  }

  window.addEventListener('resize', () => relayout());

  /* canvas hover — dots wake up under the cursor */
  const wsEl = document.getElementById('workspace');
  wsEl.addEventListener('mousemove', e => {
    const r = canvas.getBoundingClientRect();
    canvas.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    canvas.style.setProperty('--my', (e.clientY - r.top) + 'px');
    canvas.style.setProperty('--mo', '1');
  });
  wsEl.addEventListener('mouseleave', () => canvas.style.setProperty('--mo', '0'));

  /* ---------------- use-case bar (adaptive) + apps popover ---------------- */

  /* next-logical-action engine: candidates keyed to context, open tiles and CRM
     signals — recomputed after every action, almost all precomputed routes */
  function usecaseDefs() {
    const a = state.ctx.account && acctOf(state.ctx.account);
    const f = state.ctx.opp && oppOf(state.ctx.opp);
    const has = id => !!findApp(id);
    const battle = CRMD && CRMD.battle;
    const pres = a && battle && battle.presence[a.id];
    const list = [];
    const uc = (id, label, icon, key, desc, params) => list.push({ id, label, icon, route: { key, params }, desc: desc || `chose the “${label}” move` });
    const gen = (id, label, icon, say) => list.push({ id, label, icon, gen: true, say });
    const shortRisk = s => s.length > 22 ? s.slice(0, 20) + '…' : s;

    /* opportunity beats */
    if (f) {
      if (!has('oppcard') && !has('accountplan')) uc('dealroom', `${f.o.name.split(' ').slice(0, 2).join(' ')} deal room`, 'accountplan', `uc:dealroom:${f.o.id}`);
      if (!has('pricing')) uc('quote', 'Size the quote', 'pricing', `uc:quote:${f.o.id}`);
      else uc('stress', 'Stress-test 18% off', 'pricing', `disc:${f.o.id}`, `stress-tested an 18% discount on ${f.o.name}`, { pct: 18 });
      uc('close', 'Path to signature', 'oppcard', `uc:close:${f.o.id}`);
      if (has('pricing') || has('accountplan')) gen('brief', 'Exec brief', 'presentation', `Build a tight exec brief deck for the ${f.o.name} opportunity at ${f.a.name}`);
    }

    /* account beats */
    if (a) {
      if (has('callreview')) gen('follow', 'Draft the follow-up', 'notes', `Draft a crisp follow-up note for the ${a.review.title} with ${a.name}, covering the wins, the open concerns and both commitments`);
      else if (a.review && (has('callprep') || has('relationships') || !f)) uc('review', 'Review the last call', 'callreview', `uc:review:${a.id}`);
      if (a.meetings && a.meetings[0] && !has('callprep')) uc('call', 'Prep the next call', 'callprep', `uc:call:${a.id}`);
      if (!has('relationships')) uc('politics', 'Map the politics', 'relationships', `uc:politics:${a.id}`);
      else uc('champ', 'Arm the champion', 'profile', `uc:champ:${a.id}`);
      if (has('profile') || has('pricing')) uc('econ', 'Path to the money', 'profile', `uc:econ:${a.id}`);
      if (has('accountplan') && a.plan.risks[0]) uc('risk', `Defuse: ${shortRisk(a.plan.risks[0])}`, 'accountplan', `risk:${a.id}:0`);
      if (!has('oppmap')) uc('smap', 'Strategy map', 'oppmap', `smap:${a.id}`);
      else if (a.strategy) uc('goal', 'Trace goal #1', 'oppmap', `goal:${a.id}:${a.strategy.goals[0].id}`);
      if (pres && (pres.status === 'entrenched' || pres.status === 'circling')) {
        if (!has('battlecard')) uc('battle', 'Defend vs Hyperion', 'battlecard', 'intent:battle');
        else uc('land', 'Plant a landmine', 'battlecard', 'land:0');
      }
      if (!f && !has('accountplan')) uc('war', `${a.name.split(' ')[0]} war room`, 'territory', `prep:${a.id}`);
    }

    /* global beats */
    if (!a) {
      uc('morning', 'Morning review', 'metrics', 'uc:morning');
      if (!has('territory')) uc('book', 'Scan the book', 'territory', 'intent:book');
      else uc('big', 'Zoom the biggest deal', 'territory', 'deal:nw-renewal');
      uc('fire', "Where's the fire?", 'battlecard', 'intent:attention');
      if (has('pipeline') || has('metrics')) uc('win', 'Explain the win rate', 'metrics', 'kpi:Win Rate');
      if (!has('pipeline')) uc('pipe', 'Pipeline sweep', 'pipeline', 'intent:pipeline');
    }

    /* artifact beats */
    if (has('presentation')) gen('rehearse', 'Rehearse the pitch', 'podcast', 'Turn the open deck into a podcast run-through and prep flashcards so I can rehearse it');
    if (has('profile')) {
      const p = findApp('profile');
      const nm = (p.data && p.data.name) || 'them';
      gen('outreach', `Draft outreach to ${String(nm).split(' ')[0]}`, 'notes', `Draft a short, sharp outreach message to ${nm}${a ? ' at ' + a.name : ''} that advances the deal`);
    }
    if (state.apps.length >= 5) uc('clean', 'Clean slate', 'notes', 'intent:cleanup');

    /* dedupe, cap */
    const seen = new Set();
    return list.filter(x => !seen.has(x.id) && seen.add(x.id)).slice(0, 4);
  }

  let lastUC = '';
  function renderUsecases() {
    if (!ucEl) return;
    const defs = usecaseDefs();
    const sig = defs.map(d => d.id).join(',');
    if (sig === lastUC) return;
    lastUC = sig;
    ucEl.innerHTML = '';
    defs.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'uc' + (d.gen ? ' gen' : '');
      b.style.animationDelay = `${i * 55}ms`;
      b.innerHTML = `${icon(d.icon)}<span></span>`;
      b.querySelector('span').textContent = d.label;
      b.onclick = () => {
        if (state.busy) return;
        if (d.say) { sugEl.style.display = 'none'; document.body.classList.add('has-msgs'); addMsg('user', d.say); chatRequest(d.say, null); }
        else uiEvent(d.desc, d.label, d.icon, d.route);
      };
      ucEl.appendChild(b);
    });
  }

  function refreshLauncher() {
    renderUsecases();
    if (appsPop) appsPop.querySelectorAll('.ap-row').forEach(r =>
      r.classList.toggle('on', !!findApp(r.dataset.id)));
  }

  if (appsPop) {
    for (const [id, spec] of Object.entries(REGISTRY)) {
      const b = document.createElement('button');
      b.className = 'ap-row';
      b.dataset.id = id;
      b.style.setProperty('--h', spec.hue);
      b.innerHTML = `${icon(id)}<span>${spec.name}</span><i></i>`;
      b.title = spec.desc;
      b.onclick = () => {
        if (findApp(id)) closeApp(id);
        else openApp(id, 'm', null, true);
        relayout();
      };
      appsPop.appendChild(b);
    }
    const btn = document.getElementById('apps-btn');
    btn.onclick = e => { e.stopPropagation(); document.getElementById('appsmenu').classList.toggle('open'); };
    document.addEventListener('click', e => {
      if (!e.target.closest('#appsmenu')) document.getElementById('appsmenu').classList.remove('open');
    });
  }

  /* ---------------- chat ---------------- */

  /* tiny markdown — bold/italic/code, bullets, numbered lists, #### headers */
  function md(src) {
    let s = String(src || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    let out = '', list = null;
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const ln of s.split(/\n/)) {
      const h = ln.match(/^\s*#{2,4}\s+(.*)/);
      const ul = ln.match(/^\s*[-•]\s+(.*)/);
      const ol = ln.match(/^\s*\d+[.)]\s+(.*)/);
      if (h) { close(); out += `<h4>${h[1]}</h4>`; }
      else if (ul) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${ul[1]}</li>`; }
      else if (ol) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${ol[1]}</li>`; }
      else if (!ln.trim()) close();
      else { close(); out += `<p>${ln}</p>`; }
    }
    close();
    return out;
  }

  function addMsg(role, text) {
    const el = document.createElement('div');
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="bubble"></div>`;
    const b = el.querySelector('.bubble');
    if (role === 'agent') b.innerHTML = md(text);
    else b.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    fitChat();
    return el;
  }

  /* floating chat hugs its content — never taller than it needs, never dead space */
  let fitRaf = 0;
  function fitChat() {
    cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(() => {
      if (state.chatMode !== 'float' || document.body.classList.contains('chat-center')) return;
      if (state.chatManualH) return; // user-sized: hands off
      const stageH = stage.getBoundingClientRect().height;
      const sugH = sugEl.style.display === 'none' ? 0 : sugEl.offsetHeight;
      const last = log.lastElementChild;
      const logContent = last
        ? last.getBoundingClientRect().bottom - log.getBoundingClientRect().top + log.scrollTop + 14
        : 24;
      const need = 48 + 74 + sugH + logContent + 16;
      const h = Math.max(230, Math.min(need, stageH * 0.82));
      chatpane.style.setProperty('--chat-h', h + 'px');
      // keep a hand-placed card fully on stage as it grows
      if (document.body.classList.contains('chat-placed')) {
        const fy = parseFloat(chatpane.style.getPropertyValue('--fy')) || 0;
        if (fy + h > stageH - 8) chatpane.style.setProperty('--fy', Math.max(8, stageH - h - 8) + 'px');
      }
    });
  }

  function note(text) {
    const el = document.createElement('div');
    el.className = 'msg agent';
    el.innerHTML = `<div class="action-chips"><span class="achip neg"></span></div>`;
    el.querySelector('.achip').textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    fitChat();
  }

  function chipHTML(a) {
    const verbs = { open: 'Opened', close: 'Closed', resize: 'Resized', focus: 'Focused' };
    if (a.type === 'close_all') return `<span class="achip neg">Cleared workspace</span>`;
    if (a.type === 'chat') return `<span class="achip neg">Chat → ${a.mode}</span>`;
    if (a.type === 'context') return `<span class="achip neg">Context → ${ctxLabel()}</span>`;
    const spec = REGISTRY[a.app];
    if (!spec) return '';
    const neg = a.type === 'close';
    const size = a.size && a.type !== 'close' && a.type !== 'focus' ? ` · ${a.size.toUpperCase()}` : '';
    return `<span class="achip ${neg ? 'neg' : ''}" style="--h:${spec.hue}">${icon(a.app)}${verbs[a.type]} ${spec.name}${size}</span>`;
  }

  function showThinking() {
    const el = document.createElement('div');
    el.className = 'msg agent';
    el.innerHTML = `<div class="thinking"><div class="orbs"><i></i><i></i><i></i></div><span>Reshaping your workspace…</span></div>`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  const SUGGESTIONS = [
    { t: 'Which account needs my attention today?', i: 'metrics' },
    { t: 'Show my book of business', i: 'territory' },
    { t: "Map Northwind's goals to our deals", i: 'oppmap' },
    { t: 'Build a renewal deck for Northwind Energy', i: 'presentation' },
  ];
  SUGGESTIONS.forEach(s => {
    const b = document.createElement('button');
    b.className = 'sug';
    b.style.setProperty('--h', (REGISTRY[s.i] || {}).hue || 215);
    b.innerHTML = `${icon(s.i)}<span>${s.t}</span>`;
    b.onclick = () => { input.value = s.t; form.requestSubmit(); };
    sugEl.appendChild(b);
  });

  function send(text) {
    if (state.busy || !text.trim()) return;
    sugEl.style.display = 'none';
    document.body.classList.add('has-msgs');
    addMsg('user', text);
    chatRequest(text, null);
  }

  function typeInto(el, text, done) {
    let i = 0;
    const step = Math.max(2, Math.round(text.length / 45));
    const id = setInterval(() => {
      i += step;
      el.textContent = text.slice(0, i);
      log.scrollTop = log.scrollHeight;
      fitChat();
      if (i >= text.length) { clearInterval(id); el.innerHTML = md(text); if (done) done(); }
    }, 16);
  }

  async function chatRequest(content, route) {
    state.busy = true;
    sendBtn.disabled = true;
    state.history.push({ role: 'user', content });
    let thinking = showThinking();
    const clearThinking = () => { if (thinking) { thinking.remove(); thinking = null; } };
    let chipsBox = null;
    let replyEl = null;
    let finalReply = '';

    const chip = a => {
      const html = chipHTML(a);
      if (!html) return;
      if (!chipsBox) {
        const el = document.createElement('div');
        el.className = 'msg agent';
        el.innerHTML = '<div class="action-chips"></div>';
        log.appendChild(el);
        chipsBox = el.querySelector('.action-chips');
      }
      chipsBox.insertAdjacentHTML('beforeend', html);
      log.scrollTop = log.scrollHeight;
      fitChat();
    };
    const doAction = a => applyActions([a]).forEach(chip);
    const streamReply = txt => {
      if (!replyEl) { clearThinking(); replyEl = addMsg('agent', ''); }
      replyEl.querySelector('.bubble').innerHTML = md(txt);
      finalReply = txt;
      log.scrollTop = log.scrollHeight;
      fitChat();
    };

    /* incremental parser over the streamed tool-input JSON */
    const P = { buf: '', aStart: -1, pos: 0, aDone: false, rStart: -1, rDone: false };
    function pump() {
      const s = P.buf;
      if (P.aStart < 0) {
        const m = s.indexOf('"actions"');
        if (m >= 0) { const b = s.indexOf('[', m); if (b >= 0) { P.aStart = b + 1; P.pos = b + 1; } }
      }
      if (P.aStart >= 0 && !P.aDone) {
        let i = P.pos, depth = 0, inStr = false, esc = false, objStart = -1;
        for (; i < s.length; i++) {
          const c = s[i];
          if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
          if (c === '"') { inStr = true; continue; }
          if (c === '{') { if (depth === 0) objStart = i; depth++; }
          else if (c === '}') {
            depth--;
            if (depth === 0 && objStart >= 0) {
              try { doAction(JSON.parse(s.slice(objStart, i + 1))); } catch {}
              objStart = -1;
              P.pos = i + 1;
            }
          } else if (c === ']' && depth === 0) { P.aDone = true; P.pos = i + 1; break; }
        }
        if (!P.aDone) P.pos = (depth > 0 && objStart >= 0) ? objStart : i;
      }
      if (P.aDone && P.rStart < 0) {
        const m = s.indexOf('"reply"', P.pos);
        if (m >= 0) { const q = s.indexOf('"', s.indexOf(':', m) + 1); if (q >= 0) P.rStart = q + 1; }
      }
      if (P.rStart >= 0 && !P.rDone) {
        let i = P.rStart, esc = false, end = -1;
        for (; i < s.length; i++) {
          const c = s[i];
          if (esc) { esc = false; continue; }
          if (c === '\\') { esc = true; continue; }
          if (c === '"') { end = i; break; }
        }
        const raw = s.slice(P.rStart, end >= 0 ? end : s.length);
        for (let cut = 0; cut < 4; cut++) {
          try { streamReply(JSON.parse('"' + (cut ? raw.slice(0, raw.length - cut) : raw) + '"')); break; } catch {}
        }
        if (end >= 0) P.rDone = true;
      }
    }

    const playHit = ev => {
      clearThinking();
      // one layout pass — no zig-zag; chips stagger for narrative
      const applied = applyActions(ev.actions || []);
      applied.forEach((a, i) => setTimeout(() => chip(a), 50 + i * 110));
      finalReply = ev.reply || '';
      if (finalReply) setTimeout(() => {
        replyEl = addMsg('agent', '');
        typeInto(replyEl.querySelector('.bubble'), finalReply);
      }, 200);
    };

    try {
      const res = await fetch('api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          history: state.history.slice(-40),
          layout: state.apps.map(a => ({ app: a.id, size: a.size, focus: a.focus })),
          chat: state.chatMode,
          context: { account: state.ctx.account, opportunity: state.ctx.opp },
          route: route || null,
        }),
      });
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok || ctype.includes('application/json')) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let sse = '';
      let streamErr = null;
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        let nl;
        while ((nl = sse.indexOf('\n')) >= 0) {
          const line = sse.slice(0, nl).trim();
          sse = sse.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.t === 'd') { P.buf += ev.j; pump(); }
          else if (ev.t === 'hit') playHit(ev);
          else if (ev.t === 'err') { streamErr = ev.m || 'stream error'; break outer; }
        }
      }
      if (streamErr) throw new Error(streamErr);
      pump();
      clearThinking();
      if (finalReply) state.history.push({ role: 'assistant', content: finalReply });
    } catch (err) {
      clearThinking();
      const el = addMsg('agent', err.message === 'Failed to fetch' ? 'Could not reach the backend — is the server running?' : err.message);
      el.classList.add('error');
    } finally {
      state.busy = false;
      sendBtn.disabled = false;
      input.focus();
      fitChat();
      if (state.pendingEvt) {
        const pe = state.pendingEvt;
        state.pendingEvt = null;
        chatRequest(`[UI EVENT] ${pe.desc}`, pe.route || null);
      }
    }
  }

  form.addEventListener('submit', e => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    send(t);
  });

  /* ---------------- in-app UI events → agent ---------------- */

  function eventChip(label, appId) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.innerHTML = `<div class="action-chips"><span class="achip evt">${icon(appId || 'pointer')}<i></i></span></div>`;
    el.querySelector('i').textContent = label;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    fitChat();
  }

  function uiEvent(desc, label, appId, route) {
    sugEl.style.display = 'none';
    document.body.classList.add('has-msgs');
    eventChip(label, appId);
    if (state.busy) { state.pendingEvt = { desc, route }; return; }
    chatRequest(`[UI EVENT] ${desc}`, route || null);
  }

  document.addEventListener('chameleon:event', e => {
    const d = e.detail || {};
    if (d.kind === 'person' && d.person) {
      const p = d.person;
      openApp('profile', 'm', { name: p.name, role: p.role, account: d.account, sentiment: p.sentiment }, true);
      relayout();
      uiEvent(
        `The user clicked stakeholder "${p.name}" (${p.role || 'role unknown'}, ${p.sentiment || 'neutral'}) in the relationship map for ${d.account || 'the account'}. A profile tile is already open and auto-filled from the CRM. Optionally enrich it further and arrange the workspace around this person; reply with ONE sharp insight, not a summary.`,
        `Selected ${p.name}`, 'profile', { key: `person:${p.name}` });
      return;
    }
    if (d.desc) {
      if (d.instant && REGISTRY[d.instant.app]) {
        openApp(d.instant.app, d.instant.size || 'm', d.instant.data, true);
        relayout();
      }
      uiEvent(`The user ${d.desc}`, d.label || 'Clicked', d.icon, d.route || null);
    }
  });

  /* ---------------- boot / demo params ---------------- */

  Apps.configure({ crm: CRMD, getContext: () => state.ctx, selectContext, logEl: log });
  buildCtxBar();

  applyChatMode(state.chatMode);
  if (params.has('chat')) applyChatMode(params.get('chat'));
  if (params.has('ctx')) {
    const [ca, co] = params.get('ctx').split(':');
    setContext(ca || null, co || null, { quiet: true });
  }

  if (params.has('demo')) {
    params.get('demo').split(',').filter(Boolean).forEach(tok => {
      const [id, size] = tok.split(':');
      openApp(id.trim(), size || 'm', null, false);
    });
    const last = state.apps[state.apps.length - 1];
    if (last) setFocus(last.id);
  } else if (CRMD) {
    const pipeK = CRMD.accounts.reduce((s, a) => s + a.opps.reduce((x, o) => x + o.value, 0), 0);
    addMsg('agent', `Morning. Five accounts, $${(pipeK / 1000).toFixed(1)}M in pipeline. Ironpeak's RFP is due Aug 22 and Northwind's renewal closes Sep 30 — where do we start?`);
  }
  relayout();

  /* one-time onboarding */
  if (!localStorage.getItem('cham_onboard') && !params.has('snap') && !params.has('demo') && !params.has('say')) {
    const ob = document.createElement('div');
    ob.id = 'onboard';
    ob.innerHTML = `
      <div id="ob-card">
        <div class="ob-hi"><img class="ob-glyph" src="chameleon.png" alt=""><em>Hey, Matt</em></div>
        <h2>This workspace adapts to you</h2>
        <div class="ob-row"><i>✦</i><span>Just talk — tools open, resize and clear themselves as the conversation moves. Rearrange anything and it learns your preferences.</span></div>
        <div class="ob-row"><i>⚡</i><span><b>Top right</b> holds your dynamic quick actions — always the next logical move, changing as you work.</span></div>
        <div class="ob-row"><i>◉</i><span>Everything is clickable — people, deals, numbers all pull the thread.</span></div>
        <div class="ob-row"><i>✥</i><span>Grab any card: <b>top half moves</b> it, <b>bottom half resizes</b> it.</span></div>
        <div class="ob-row"><i>⬚</i><span>The chat floats — drag it to an <b>edge to dock</b>, the <b>corner to minimize</b>. Try <b>bottom-middle</b>: it becomes a whole different composer.</span></div>
        <button id="ob-go">Let’s go</button>
      </div>`;
    document.body.appendChild(ob);
    const close = () => { localStorage.setItem('cham_onboard', '1'); ob.classList.add('out'); setTimeout(() => ob.remove(), 300); };
    ob.querySelector('#ob-go').onclick = close;
    ob.addEventListener('click', e => { if (e.target === ob) close(); });
  }

  if (params.has('say')) setTimeout(() => send(params.get('say')), 300);

  // styling hook: ?mdtest=<encoded markdown> renders an agent bubble
  if (params.has('mdtest')) addMsg('agent', params.get('mdtest'));

  // test hook: ?evtdesc=...&evtlabel=... dispatches a generic UI event
  if (params.has('evtdesc')) {
    setTimeout(() => document.dispatchEvent(new CustomEvent('chameleon:event', {
      detail: { desc: params.get('evtdesc'), label: params.get('evtlabel') || 'Clicked', icon: params.get('evticon') || undefined },
    })), 700);
  }

  // test/demo hook: ?evt=person:Priya Raman
  if (params.has('evt')) {
    const [kind, name] = params.get('evt').split(':');
    setTimeout(() => {
      if (kind === 'person') {
        const a = findApp('relationships');
        const people = (a && a.data && a.data.people && a.data.people.length ? a.data.people : Apps.DEFAULTS.relationships.people);
        const p = people.find(x => x.name === name) || people[0];
        if (p) document.dispatchEvent(new CustomEvent('chameleon:event', { detail: { kind: 'person', person: p, account: 'Northwind Energy' } }));
      }
    }, 700);
  }

  input.focus();
})();
