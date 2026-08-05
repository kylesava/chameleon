/* The fused chat surface (UX commandments 1, 4, 5):
   - one composer, always present; history rises above it
   - history yields while the agent acts in apps (body.acting — main.js drives it)
   - while a turn runs, the send button IS the stop button (interruption,
     not permission)
   Streams /api/chat SSE and forwards semantic events to main.js. */
(function () {
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const dock = document.getElementById('chatdock');
  const statusEl = document.getElementById('chat-status');
  const collapseBtn = document.getElementById('chat-collapse');
  const whereEl = document.getElementById('chat-where');

  /* The card backdrop exists only when there is history to hold — otherwise
     the composer floats bare over the workspace. */
  function syncFused() {
    dock.classList.toggle('fused',
      document.body.classList.contains('has-msgs') && !document.body.classList.contains('chat-center'));
  }

  /* ---------------- placement (dock left/right, centre, minimised) ----------------
     The surface stays fused; this is only WHERE it sits. Persisted per browser. */
  const PLACES = ['center', 'left', 'right', 'mini'];
  const LABEL = { center: 'centre', left: 'docked left', right: 'docked right', mini: 'minimised' };
  // ?place=left|right|center|mini overrides the stored preference (handy for
  // demo links and screenshots); it does not overwrite what you last chose.
  const urlPlace = new URLSearchParams(location.search).get('place');
  let place = urlPlace || localStorage.getItem('cham_place') || 'center';
  let collapsed = localStorage.getItem('cham_collapsed') === '1';
  /* A transient tuck, distinct from the stored preference: once there is a
     workspace to look at, the centred history stops blanketing it. The teaching
     lives in the app windows now, so the transcript should not be sitting on
     top of them. One click brings it back, and that choice sticks. */
  let tucked = false;
  let onPlaceChange = () => {};

  function applyPlace(p, opts = {}) {
    if (!PLACES.includes(p)) return;
    place = p;
    if (!opts.transient) localStorage.setItem('cham_place', p);
    for (const x of PLACES) document.body.classList.toggle('place-' + x, x === p);
    whereEl.textContent = LABEL[p];
    syncCollapse();
    onPlaceChange();
  }

  function syncCollapse() {
    // minimised implies hidden history; otherwise honour the user's toggle
    const hidden = collapsed || tucked || place === 'mini';
    document.body.classList.toggle('chat-collapsed', hidden);
    collapseBtn.title = hidden ? 'Show the conversation' : 'Hide the conversation';
    collapseBtn.setAttribute('aria-expanded', String(!hidden));
  }
  function setCollapsed(v) {
    collapsed = v;
    tucked = false;                 // an explicit choice outranks the auto-tuck
    localStorage.setItem('cham_collapsed', v ? '1' : '0');
    syncCollapse();
    if (!v) scroll();
  }
  /* Called when a turn settles: fold the transcript away if there is now
     something in the workspace worth the space. */
  function tuck(hasWorkspace) {
    syncFused();                    // the hero may have just been dismissed
    const want = !!hasWorkspace && place === 'center' && !collapsed;
    if (want === tucked) return;
    tucked = want;
    syncCollapse();
  }

  collapseBtn.addEventListener('click', e => { e.preventDefault(); setCollapsed(!collapsed); });

  /* click the minimised pill to bring it back */
  dock.addEventListener('click', e => {
    if (place === 'mini' && !e.target.closest('#chat-form, #chat-collapse')) {
      applyPlace(localStorage.getItem('cham_place_prev') || 'center');
    }
  });

  /* drag the grip: edges dock, bottom-right corner minimises, else centre */
  const stage = document.getElementById('stage');
  const zones = {};
  for (const [id, label] of [['left', 'Dock left'], ['right', 'Dock right'], ['center', 'Centre'], ['mini', 'Minimise']]) {
    const z = document.createElement('div');
    z.className = 'zone';
    z.id = 'zone-' + id;
    z.textContent = label;
    stage.appendChild(z);
    zones[id] = z;
  }
  // the whole bar is the handle, not just the dots — that's what people grab
  document.getElementById('chat-bar').addEventListener('mousedown', e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    if (document.body.classList.contains('acting')) return; // don't move it mid-action
    e.preventDefault();
    const sr = stage.getBoundingClientRect();
    let moved = false, target = place;
    const mv = ev => {
      if (!moved) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
        moved = true;
        document.body.classList.add('chatzones', 'dragging', 'chat-lifted');
      }
      // the panel comes with you — a drop-zone highlight alone reads as broken
      dock.style.setProperty('--drag-x', (ev.clientX - e.clientX) + 'px');
      dock.style.setProperty('--drag-y', (ev.clientY - e.clientY) + 'px');

      const x = ev.clientX - sr.left, y = ev.clientY - sr.top;
      target = (y > sr.height - 120 && x > sr.width - 320) ? 'mini'
        : x < 210 ? 'left'
        : x > sr.width - 210 ? 'right'
        : 'center';
      for (const k in zones) zones[k].classList.toggle('arm', target === k);
    };
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('chatzones', 'dragging', 'chat-lifted');
      dock.style.removeProperty('--drag-x');
      dock.style.removeProperty('--drag-y');
      for (const k in zones) zones[k].classList.remove('arm');
      if (!moved) return;
      if (target === 'mini' && place !== 'mini') localStorage.setItem('cham_place_prev', place);
      applyPlace(target);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  });

  /* ---------------- ephemeral status (commandment 7) ----------------
     Shown while the agent works; never written to history. */
  function setStatus(text, thinking) {
    statusEl.querySelector('span').textContent = text || '';
    statusEl.classList.toggle('thinking', !!thinking);
    document.body.classList.toggle('has-status', !!text);
  }

  let CFG = {
    sessionId: () => null,
    onEvent: () => {},      // server event → main's action queue
    onTurnDone: () => {},   // stream closed (queue may still be playing)
  };
  let abortCtl = null;
  let pendingBubble = null; // streaming agent reply
  let pendingText = '';
  let queuedEvent = null;   // a UI event fired while busy — sent after

  const md = s => Apps.md(s);

  function scroll() { log.scrollTop = log.scrollHeight; }

  function addMsg(role, html, cls = '') {
    const el = document.createElement('div');
    el.className = `msg ${role} ${cls}`;
    el.innerHTML = `<div class="bubble"></div>`;
    el.querySelector('.bubble').innerHTML = html;
    log.appendChild(el);
    scroll();
    return el;
  }

  const addUser = text => addMsg('user', Apps.esc(text));
  const addAgent = text => addMsg('agent', md(text));
  const addError = text => addMsg('agent', Apps.esc(text), 'error');

  function addChip(label, ico) {
    const el = document.createElement('div');
    el.className = 'msg user chipline';
    el.innerHTML = `<span class="achip evt">${Apps.icon(ico || 'pointer')}<i></i></span>`;
    el.querySelector('i').textContent = label;
    log.appendChild(el);
    scroll();
  }

  function addNarration(app, text) {
    const spec = Apps.REGISTRY[app];
    const el = document.createElement('div');
    el.className = 'msg agent chipline';
    el.innerHTML = `<span class="achip" style="--h:${spec ? spec.hue : 220}">${Apps.icon(app)}<i></i></span>`;
    el.querySelector('i').textContent = text;
    log.appendChild(el);
    scroll();
  }

  /* `hasWorkspace` matters as much as the message count: coming back to a
     journey that already has windows open must not greet you with the
     full-screen hero sitting on top of them. */
  function renderHistory(messages, hasWorkspace) {
    log.innerHTML = '';
    for (const m of messages) {
      if (m.kind === 'narration') addNarration(m.app, m.content);
      // events show their saved learner-facing label, never the model-facing text
      else if (m.kind === 'event') addChip(m.app || tidyEvent(m.content), 'pointer');
      else if (m.role === 'user') addUser(m.content);
      else addAgent(m.content);
    }
    document.body.classList.toggle('has-msgs', messages.length > 0);
    document.body.classList.toggle('chat-center', messages.length === 0 && !hasWorkspace);
    syncFused();
    scroll();
  }
  const firstLine = s => String(s).split('\n')[0];
  /* Fallback for events saved before labels existed: strip the marker and any
     internal ids so the transcript never shows plumbing. */
  const tidyEvent = s => firstLine(s)
    .replace(/^\[UI EVENT\]\s*(The user\s*)?/i, '')
    .replace(/\s*\(artifact #\d+\)/gi, '')
    .replace(/\s*#\d+/g, '')
    .replace(/\.$/, '')
    .slice(0, 80) || 'Interacted';

  /* ---- streaming reply bubble ---- */
  function saySink(delta) {
    if (!pendingBubble) pendingBubble = addMsg('agent', '');
    pendingText += delta;
    pendingBubble.querySelector('.bubble').innerHTML = md(pendingText);
    scroll();
  }

  function setBusy(on) {
    document.body.classList.toggle('busy', on);
    if (!on) { document.body.classList.remove('acting'); setStatus(null); }
  }

  /* ---- the turn ---- */
  async function send(content, kind, chipInfo) {
    if (!content.trim()) return;
    if (document.body.classList.contains('busy')) {
      if (kind === 'event') queuedEvent = { content, chipInfo }; // fires after this turn
      return;
    }
    document.body.classList.add('has-msgs');
    document.body.classList.remove('chat-center');
    syncFused();
    if (kind === 'event') addChip(chipInfo?.label || 'Clicked', chipInfo?.icon);
    else addUser(content);

    setBusy(true);
    pendingBubble = null;
    pendingText = '';
    abortCtl = new AbortController();

    try {
      const res = await fetch('api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: abortCtl.signal,
        body: JSON.stringify({
          session_id: CFG.sessionId(),
          content,
          kind: kind || 'chat',
          label: kind === 'event' ? (chipInfo?.label || null) : null,
        }),
      });
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok || ctype.includes('application/json')) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(5)); } catch { continue; }
          if (ev.t === 'say') saySink(ev.d);
          else if (ev.t === 'err') addError(ev.m);
          else CFG.onEvent(ev);
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        addError(err.message === 'Failed to fetch' ? 'Could not reach the backend — is the server running?' : err.message);
      }
    }
    finishStream();
  }

  function finishStream() {
    abortCtl = null;
    CFG.onTurnDone(); // main fast-forwards / drains the queue, then calls turnSettled()
  }

  /* main.js calls this once the action queue is fully drained */
  function turnSettled() {
    setBusy(false);
    if (pendingBubble && !pendingText.trim()) { pendingBubble.remove(); }
    pendingBubble = null;
    pendingText = '';
    input.focus();
    scroll();
    if (queuedEvent) {
      const q = queuedEvent;
      queuedEvent = null;
      send(q.content, 'event', q.chipInfo);
    }
  }

  function stop() {
    window.dispatchEvent(new Event('chameleon:stopped')); // main fast-forwards its queue
    if (abortCtl) abortCtl.abort(); // server sees the close and aborts upstream
  }

  /* ---- wiring ---- */
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (document.body.classList.contains('busy')) { stop(); return; }
    const t = input.value;
    input.value = '';
    send(t, 'chat');
  });
  sendBtn.addEventListener('click', e => {
    if (document.body.classList.contains('busy')) { e.preventDefault(); stop(); }
  });

  window.Chat = {
    configure: o => {
      CFG = { ...CFG, ...o };
      if (o.onPlaceChange) { onPlaceChange = o.onPlaceChange; }
    },
    send,
    sendEvent: (desc, label, icon) => send(`[UI EVENT] The user ${desc}`, 'event', { label, icon }),
    renderHistory, addAgent, addUser, addChip, addNarration, addError,
    turnSettled, stop, setStatus, tuck,
    /* The spine has appeared in the conversation — make sure the surface it
       lives on is a card and not the full-screen hero. */
    showPlan() {
      document.body.classList.remove('chat-center');
      document.body.classList.add('has-msgs');
      syncFused();
    },
    place: () => place,
    applyPlace,
    isBusy: () => document.body.classList.contains('busy'),
    /* True while the turn's SSE stream is still open. The action queue empties
       constantly mid-turn — events arrive slower than they play — so "queue is
       empty" must never be mistaken for "the agent has finished". */
    streaming: () => !!abortCtl,
    fillInput: t => { input.value = t; input.focus(); },
  };
  applyPlace(place, { transient: !!urlPlace });
})();
