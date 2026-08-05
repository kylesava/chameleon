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
  const QUESTIONS = [
    {
      key: 'spread',
      q: 'You ask to learn something. Chameleon writes a lesson and a quiz on it.',
      sub: 'What should it put on screen?',
      options: [
        { v: 'one', label: 'Just the lesson', sub: 'Bring the quiz when I have finished reading',
          sets: { parallelism: 1, pace: 'guided' } },
        { v: 'two', label: 'The lesson, quiz beside it', sub: 'I can glance across when I want to',
          sets: { parallelism: 2, pace: 'blended' } },
        { v: 'all', label: 'Everything it has made', sub: 'Lesson, quiz, cards — I like room to roam',
          sets: { parallelism: 4, pace: 'firehose' } },
      ],
    },
    {
      key: 'checkins',
      q: 'You have finished reading. Chameleon thinks you are ready for step 2.',
      sub: 'What should it do?',
      options: [
        { v: 'every-step', label: 'Ask me first', sub: 'I will say when I am ready to move on' },
        { v: 'every-stage', label: 'Carry on, ask at the end of a section', sub: 'Check in at the natural breaks' },
        { v: 'rarely', label: 'Just go', sub: 'I will stop you if I need to' },
      ],
    },
    {
      key: 'planPlace',
      q: 'Chameleon has mapped out six steps to get you there.',
      sub: 'Where do you want to see them?',
      options: [
        { v: 'chat', label: 'In the conversation', sub: 'So I can talk to it about the plan and say when I am ready' },
        { v: 'window', label: 'In its own window', sub: 'Open beside the work, so I can see where I am at a glance' },
      ],
    },
    {
      key: 'voice',
      q: 'There is a diagram on screen and Chameleon wants to point something out about it.',
      sub: 'Where should it say that?',
      options: [
        { v: 'windows', label: 'Next to the diagram', sub: 'Where the thing it is talking about is', sets: { chatter: 'minimal' } },
        { v: 'both', label: 'Both', sub: 'Beside the diagram, and the wider point in chat', sets: { chatter: 'normal' } },
        { v: 'chat', label: 'In the chat', sub: 'I would rather it talked to me than annotated things', sets: { chatter: 'full' } },
      ],
    },
    {
      key: 'visuals',
      q: 'It is explaining how something works — a process with a few moving parts.',
      sub: 'What actually helps you?',
      options: [
        { v: 'plain', label: 'Write it out', sub: 'Clear prose and a table if it needs one' },
        { v: 'diagrams', label: 'A diagram and the explanation', sub: 'Picture for the shape, words for the detail' },
        { v: 'rich', label: 'Show me as much as possible', sub: 'Diagrams, charts, illustrations — I think in pictures' },
      ],
    },
  ];

  function onboarding(user) {
    const answers = {};
    let i = 0;

    const render = () => {
      const q = QUESTIONS[i];
      const chosen = answers[q.key];
      show(`
        <div class="gate-progress">${QUESTIONS.map((_, n) => `<i class="${n < i ? 'done' : n === i ? 'on' : ''}"></i>`).join('')}</div>
        <h1>${esc(q.q)}</h1>
        <p class="gate-sub">${esc(q.sub || '')}</p>
        ${i === 0 ? `<p class="gate-intro">Five questions about how you like to work${user ? `, ${esc(user.display_name)}` : ''} — no right answers, and all of it changeable later.</p>` : ''}
        <div class="gate-options">
          ${q.options.map(o => `<button class="gate-opt ${chosen === o.v ? 'on' : ''}" data-v="${esc(o.v)}">
              <b>${esc(o.label)}</b><span>${esc(o.sub)}</span></button>`).join('')}
        </div>
        <div class="gate-actions">
          ${i > 0 ? '<button class="gate-back" type="button">Back</button>' : ''}
          <button class="gate-next" type="button">Skip</button>
        </div>`);

      body.querySelectorAll('.gate-opt').forEach(b => b.onclick = () => {
        const v = b.dataset.v;
        answers[q.key] = v;
        const opt = q.options.find(o => o.v === v);
        if (opt && opt.sets) Object.assign(answers, opt.sets);
        next();
      });
      const back = body.querySelector('.gate-back');
      if (back) back.onclick = () => { i = Math.max(0, i - 1); render(); };
      body.querySelector('.gate-next').onclick = next;
    };

    const next = async () => {
      if (i < QUESTIONS.length - 1) { i++; render(); return; }
      show('<h1>Setting up your workspace…</h1><div class="gate-spin"></div>');
      try {
        await api('api/profile', { onboarded: true, stated: answers });
      } catch { /* a failed save must not lock them out of their own app */ }
      done();
    };

    render();
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
