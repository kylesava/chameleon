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

  /* The card backdrop exists only when there is history to hold — otherwise
     the composer floats bare over the workspace. */
  function syncFused() {
    dock.classList.toggle('fused',
      document.body.classList.contains('has-msgs') && !document.body.classList.contains('chat-center'));
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

  function renderHistory(messages) {
    log.innerHTML = '';
    for (const m of messages) {
      if (m.kind === 'narration') addNarration(m.app, m.content);
      else if (m.kind === 'event') addChip(firstLine(m.content).replace(/^\[UI EVENT\]\s*/, '').slice(0, 90), 'pointer');
      else if (m.role === 'user') addUser(m.content);
      else addAgent(m.content);
    }
    document.body.classList.toggle('has-msgs', messages.length > 0);
    document.body.classList.toggle('chat-center', messages.length === 0);
    syncFused();
    scroll();
  }
  const firstLine = s => String(s).split('\n')[0];

  /* ---- streaming reply bubble ---- */
  function saySink(delta) {
    if (!pendingBubble) pendingBubble = addMsg('agent', '');
    pendingText += delta;
    pendingBubble.querySelector('.bubble').innerHTML = md(pendingText);
    scroll();
  }

  function setBusy(on) {
    document.body.classList.toggle('busy', on);
    if (!on) document.body.classList.remove('acting');
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
        body: JSON.stringify({ session_id: CFG.sessionId(), content, kind: kind || 'chat' }),
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
    configure: o => { CFG = { ...CFG, ...o }; },
    send,
    sendEvent: (desc, label, icon) => send(`[UI EVENT] The user ${desc}`, 'event', { label, icon }),
    renderHistory, addAgent, addUser, addChip, addNarration, addError,
    turnSettled, stop,
    isBusy: () => document.body.classList.contains('busy'),
    fillInput: t => { input.value = t; input.focus(); },
  };
})();
