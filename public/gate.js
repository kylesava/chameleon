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
        else onboarding();
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
  /* No question at all. Everyone starts at the same sensible pace; the dial
     lives in settings, the agent learns from how they actually work, and they
     can simply say "slow down". Asking a stranger to configure a product they
     have not used yet was friction dressed up as personalisation. */
  async function onboarding() {
    try {
      await api('api/profile', { onboarded: true, mode: 'walk' });
    } catch { /* a failed save must not lock them out of their own app */ }
    done();
  }

  /* ---------------- boot ---------------- */
  (async () => {
    try {
      const me = await api('api/me');
      if (!me.user) return login(me.users);
      if (!me.profile || !me.profile.onboarded) return onboarding();
      done();
    } catch {
      login([]);
    }
  })();

  window.Gate = { ready: () => ready };
})();
