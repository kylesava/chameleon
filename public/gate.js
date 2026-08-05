/* Sign-in, and the short baseline that tells Chameleon how this person likes
   to work. Runs before the workspace boots; main.js waits on Gate.ready(). */
(function () {
  const gate = document.getElementById('gate');
  const body = document.getElementById('gate-body');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const api = async (path, payload, method) => {
    const res = await fetch(path, {
      method: method || (payload ? 'POST' : 'GET'),
      headers: payload ? { 'content-type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  };

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });

  function show(html) {
    body.innerHTML = html;
    document.body.classList.add('gated');
  }
  function done() {
    gate.classList.add('out');
    document.body.classList.remove('gated');
    setTimeout(() => gate.remove(), 420);
    resolveReady();
  }

  /* ---------------- sign in ---------------- */
  function login(users) {
    show(`
      <h1>Welcome back</h1>
      <p>Chameleon keeps your plan, your notebook and the way you like to work.</p>
      <form id="gate-form" autocomplete="on">
        <input id="gate-user" name="username" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
        <input id="gate-pass" name="password" type="password" placeholder="Password" autocomplete="current-password">
        <button type="submit">Sign in</button>
        <div class="gate-err" hidden></div>
      </form>
      ${users && users.length ? `<div class="gate-hint">accounts: ${users.map(esc).join(' · ')}</div>` : ''}`);

    const form = document.getElementById('gate-form');
    const err = body.querySelector('.gate-err');
    const user = document.getElementById('gate-user');
    user.focus();
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      err.hidden = true;
      try {
        await api('api/login', { username: user.value, password: document.getElementById('gate-pass').value });
        const me = await api('api/me');
        if (me.profile && me.profile.onboarded) done();
        else onboarding(me.user);
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Sign in';
        document.getElementById('gate-pass').select();
      }
    };
  }

  /* ---------------- the baseline ----------------
     Five questions, one screen each, phrased as situations rather than
     settings — people answer "what would you rather" far more honestly than
     "set your parallelism". */
  /* ONE question. The five-question version asked good things, but it is
     friction in front of someone who just wants to start, and everything it
     asked is either learned from use or said in the chat later. What is left
     is the only choice that changes the shape of the product. */
  const MODES = [
    {
      v: 'simple', label: 'One thing at a time',
      sub: 'A lesson, then a quiz — never both. It asks before moving on, and the plan lives in our conversation.',
    },
    {
      v: 'balanced', label: 'A steady pace',
      sub: 'Usually one thing, sometimes a second beside it. It checks in at natural breaks rather than every step.',
    },
    {
      v: 'extreme', label: 'Everything at once',
      sub: 'Lesson, quiz and plan side by side, moving without asking. Room to jump around.',
    },
  ];

  function onboarding(user) {
    show(`
      <h1>How much at once?</h1>
      <p class="gate-sub">${user ? `Hi ${esc(user.display_name)}. ` : ''}One question, and you can change it whenever — or just tell me.</p>
      <div class="gate-options">
        ${MODES.map(m => `<button class="gate-opt" data-v="${m.v}">
          <b>${esc(m.label)}</b><span>${esc(m.sub)}</span></button>`).join('')}
      </div>`);

    body.querySelectorAll('.gate-opt').forEach(b => b.onclick = async () => {
      const mode = b.dataset.v;
      body.querySelectorAll('.gate-opt').forEach(x => x.classList.toggle('on', x === b));
      show('<h1>Setting up your workspace…</h1><div class="gate-spin"></div>');
      try {
        await api('api/profile', { onboarded: true, mode });
      } catch { /* a failed save must not lock them out of their own app */ }
      done();
    });
  }

  /* ---------------- boot ---------------- */
  (async () => {
    try {
      const me = await api('api/me');
      if (!me.user) return login(me.users);
      if (!me.profile || !me.profile.onboarded) return onboarding(me.user);
      done();
    } catch {
      login([]);
    }
  })();

  window.Gate = { ready: () => ready };
})();
