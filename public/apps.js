/* Learning-app registry + renderers.
   Every app: grid sizes per s/m/l/xl, a max grow bound, icon, hue, and a
   render(el, app) that draws live session state. Interactions dispatch
   'chameleon:event' — main.js turns them into [UI EVENT] agent turns. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./richtext.js'));
  else root.Apps = factory(root.Rich);
})(typeof self !== 'undefined' ? self : this, function (Rich) {

  const esc = Rich.esc;
  const short = s => { s = String(s ?? ''); return s.length > 30 ? s.slice(0, 28) + '…' : s; };

  const md = Rich.md;

  /* ---- icons (inline SVG, 16px, stroke) ---- */
  const I = {
    plan: '<path d="M5.5 3h8M5.5 8h8M5.5 13h8"/><path d="M2 2.6l.8.8L4.2 2M2 7.6l.8.8L4.2 7M2 12.6l.8.8 1.4-1.4"/>',
    sources: '<path d="M3 2.5h7l3 3V13.5H3z"/><path d="M10 2.5v3h3M5.5 8h5M5.5 10.5h5"/>',
    lesson: '<path d="M8 3.5C6.5 2.3 4.5 2 2.5 2.3V13c2-.3 4 0 5.5 1.2 1.5-1.2 3.5-1.5 5.5-1.2V2.3C11.5 2 9.5 2.3 8 3.5z"/><path d="M8 3.5V14"/>',
    quiz: '<circle cx="8" cy="8" r="6"/><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.2"/><circle cx="8" cy="11.3" r="0.5" fill="currentColor"/>',
    flashcards: '<rect x="4.5" y="2.5" width="9" height="7" rx="1.5"/><rect x="2.5" y="6" width="9" height="7" rx="1.5"/>',
    podcast: '<rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14"/>',
    deck: '<rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 13.5h4M8 11v2.5"/>',
    pointer: '<path d="M4.5 2.5l8 6.5-4 .9 2 4.6-2 .9-2-4.6-2.8 3z"/>',
  };
  const icon = id => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${I[id] || I.lesson}</svg>`;

  /* ---- registry ---- */
  const REGISTRY = {
    plan:       { name: 'Plan',       hue: 212, sizes: { s: [2, 2], m: [3, 3], l: [4, 4], xl: [5, 6] }, max: [5, 6], desc: 'Your lesson plan — check off goals as you go' },
    sources:    { name: 'Notebook',   hue: 20,  sizes: { s: [2, 2], m: [3, 3], l: [4, 5], xl: [5, 6] }, max: [5, 6], desc: 'Study material: pasted text, links, and notes' },
    lesson:     { name: 'Lesson',     hue: 172, sizes: { s: [3, 2], m: [4, 3], l: [5, 5], xl: [6, 6] }, max: [8, 6], desc: 'The current lesson — click a section to go deeper' },
    quiz:       { name: 'Quiz',       hue: 268, sizes: { s: [2, 2], m: [3, 3], l: [4, 5], xl: [6, 6] }, max: [6, 6], desc: 'Interactive check of what stuck' },
    flashcards: { name: 'Flashcards', hue: 38,  sizes: { s: [2, 2], m: [3, 2], l: [4, 3], xl: [5, 4] }, max: [5, 4], desc: 'Spaced practice deck' },
    podcast:    { name: 'Podcast',    hue: 330, sizes: { s: [2, 1], m: [3, 2], l: [4, 3], xl: [4, 4] }, max: [4, 4], desc: 'Two-host audio overview with real voices' },
    deck:       { name: 'Deck',       hue: 292, sizes: { s: [3, 2], m: [4, 3], l: [5, 4], xl: [8, 6] }, max: [8, 6], desc: 'Slides you can present, with speaker notes' },
  };

  /* ---- session-state wiring (configured by main.js at boot) ---- */
  let CTX = {
    getPlan: () => null,
    getSources: () => [],
    currentArtifact: () => null,
    ttsEnabled: () => false,
    sessionId: () => null,
    draftFor: () => null,
    statusFor: () => null,
    planChanged: () => {},
    sourceAdded: () => {},
    sourceRemoved: () => {},
    api: async () => { throw new Error('not configured'); },
  };
  function configure(o) { CTX = { ...CTX, ...o }; }

  /* Items streaming into this app right now (commandment 7), or null. */
  const draftItems = app => {
    const d = CTX.draftFor(app);
    return d && d.items.length ? d.items : null;
  };
  const isDrafting = app => !!CTX.draftFor(app);
  const draftHead = app => (CTX.draftFor(app) || {}).head || {};
  /* the shimmer that says "more is coming" while the model is still writing */
  const writingRow = (label) => `<div class="writing"><i></i><i></i><i></i><span>${esc(label)}</span></div>`;
  /* a caret on the text currently being typed */
  const caret = '<i class="caret"></i>';
  /* put the caret INSIDE the last rendered block, so it trails the words
     instead of dropping to a line of its own under the paragraph */
  const mdCaret = src => {
    const html = md(src);
    return /<\/(p|li|h[3-6]|code)>\s*$/.test(html)
      ? html.replace(/<\/(p|li|h[3-6]|code)>\s*$/, `${caret}</$1>`)
      : html + caret;
  };

  /* Incremental renderer for streaming content. Rebuilding innerHTML on every
     delta would restart each item's entry animation and fight the scroll
     position, so existing nodes are updated in place and only genuinely new
     ones animate in. */
  function draftList(el, opts) {
    let root = el.querySelector('.draft-root');
    if (!root) {
      el.innerHTML = `<div class="drafting draft-root">${opts.head !== undefined ? '<div class="draft-head"></div>' : ''}<div class="draft-items"></div><div class="draft-foot"></div></div>`;
      root = el.querySelector('.draft-root');
    }
    const headEl = root.querySelector('.draft-head');
    if (headEl && headEl.__html !== opts.head) { headEl.innerHTML = opts.head || ''; headEl.__html = opts.head; }

    const list = root.querySelector('.draft-items');
    const foot = root.querySelector('.draft-foot');
    const pinned = root.scrollHeight - root.clientHeight - root.scrollTop < 60;

    opts.items.forEach((it, i) => {
      const html = opts.render(it, i);
      const node = list.children[i];
      if (node) {
        if (node.__html !== html) { node.innerHTML = html; node.__html = html; }
      } else {
        const d = document.createElement('div');
        d.className = 'draft-item born';
        d.innerHTML = html;
        d.__html = html;
        list.appendChild(d);
      }
    });
    while (list.children.length > opts.items.length) list.removeChild(list.lastChild);

    if (foot.__html !== opts.footer) { foot.innerHTML = opts.footer || ''; foot.__html = opts.footer; }
    if (pinned) root.scrollTop = root.scrollHeight;
  }

  function emit(detail) {
    document.dispatchEvent(new CustomEvent('chameleon:event', { detail }));
  }

  const empty = (el, ico, text) => {
    el.innerHTML = `<div class="app-empty">${icon(ico)}<span>${esc(text)}</span></div>`;
  };

  const R = {};

  /* ================= plan — goals we progress together =================
     Reads as shared progress the agent drives, not a to-do list handed over:
     the live goal leads, the rest is a quieter trail. Ticking is the learner's
     override (skip ahead / reopen), not the thing the system waits on. */
  R.plan = (el, app) => {
    if (isDrafting('plan')) {
      const tasks = draftItems('plan') || [];
      const title = draftHead('plan').title;
      draftList(el, {
        items: tasks,
        head: title ? `<div class="plan-title drafthead"><b>${esc(title)}</b></div>` : '',
        render: t => `<div class="plan-task"><i class="pt-mark"></i><div><b>${esc(t.title || '')}${t._partial && !t.detail ? caret : ''}</b>${t.detail ? `<span>${esc(t.detail)}</span>` : ''}</div></div>`,
        footer: writingRow(tasks.length ? 'adding goals' : 'mapping your goals'),
      });
      return;
    }
    const plan = CTX.getPlan();
    if (!plan || !plan.tasks.length) return empty(el, 'plan', 'No plan yet — tell me what you want to learn.');
    const done = plan.tasks.filter(t => t.status === 'done').length;
    const pct = Math.round(100 * done / plan.tasks.length);
    const r = 15, c = 2 * Math.PI * r;
    const stages = new Map();
    plan.tasks.forEach(t => { if (!stages.has(t.stage)) stages.set(t.stage, []); stages.get(t.stage).push(t); });
    const compact = el.clientHeight < 200;
    const live = plan.tasks.find(t => t.status === 'doing');

    el.innerHTML = `
      <div class="plan">
        <div class="plan-head">
          <svg class="plan-ring" viewBox="0 0 38 38">
            <circle cx="19" cy="19" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="4"/>
            <circle cx="19" cy="19" r="${r}" fill="none" stroke="var(--good)" stroke-width="4" stroke-linecap="round"
              stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 19 19)"/>
            <text x="19" y="22.5">${pct}%</text>
          </svg>
          <div class="plan-title"><b>${esc(plan.title)}</b><span>${done} of ${plan.tasks.length} goals</span></div>
        </div>
        ${live ? `<div class="plan-live">
          <em>working on now</em>
          <b>${esc(live.title)}</b>
          ${live.detail && !compact ? `<span>${esc(live.detail)}</span>` : ''}
        </div>` : ''}
        <div class="plan-body">
          ${[...stages.entries()].sort((a, b) => a[0] - b[0]).map(([stage, tasks]) => `
            ${stages.size > 1 && !compact ? `<div class="plan-stage">stage ${stage + 1}</div>` : ''}
            ${tasks.map(t => `
              <div class="plan-task ${t.status}" data-t="${t.id}">
                <label class="pt-tick" title="${t.status === 'done' ? 'Reopen this goal' : 'Already know this? Tick to skip it'}">
                  <input type="checkbox" ${t.status === 'done' ? 'checked' : ''}>
                  <i class="pt-mark"></i>
                </label>
                <div class="pt-text"><b contenteditable="plaintext-only" spellcheck="false" title="Click to rewrite this goal">${esc(t.title)}</b>${t.detail && !compact && t.status !== 'done' ? `<span>${esc(t.detail)}</span>` : ''}</div>
                <button class="pt-del" title="Remove this goal">×</button>
              </div>`).join('')}
          `).join('')}
          <button class="plan-add">+ add a goal</button>
        </div>
      </div>`;

    /* Rename in place. Applies on blur or Enter; Escape reverts. No agent turn
       — the plan is yours to steer and steering shouldn't cost a round trip. */
    el.querySelectorAll('.pt-text b').forEach(b => {
      const id = Number(b.closest('.plan-task').dataset.t);
      const original = b.textContent;
      b.onkeydown = ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); b.blur(); }
        else if (ev.key === 'Escape') { b.textContent = original; b.blur(); }
        ev.stopPropagation();
      };
      b.onblur = async () => {
        const title = b.textContent.trim();
        if (!title) { b.textContent = original; return; }
        if (title === original) return;
        const task = plan.tasks.find(t => t.id === id);
        if (task) task.title = title;
        try { await CTX.api('/api/task', { task_id: id, title, session_id: CTX.sessionId() }); }
        catch { b.textContent = original; }
      };
    });

    el.querySelectorAll('.pt-del').forEach(btn => btn.onclick = async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const row = btn.closest('.plan-task');
      const id = Number(row.dataset.t);
      row.classList.add('removing');
      try {
        const r = await CTX.api(`/api/task/${id}?session=${CTX.sessionId()}`, null, 'DELETE');
        if (r.plan) CTX.planChanged(r.plan);
      } catch { row.classList.remove('removing'); }
    });

    const addBtn = el.querySelector('.plan-add');
    if (addBtn) addBtn.onclick = async () => {
      const title = prompt('What else do you want to cover?');
      if (!title || !title.trim()) return;
      try {
        const r = await CTX.api('/api/task/new', { session_id: CTX.sessionId(), title: title.trim() });
        if (r.plan) CTX.planChanged(r.plan);
      } catch (e) { alert(e.message); }
    };

    el.querySelectorAll('.plan-task input').forEach(cb => cb.onchange = async () => {
      const id = Number(cb.closest('.plan-task').dataset.t);
      const task = plan.tasks.find(t => t.id === id);
      const status = cb.checked ? 'done' : 'todo';
      try { await CTX.api('/api/task', { task_id: id, status, session_id: CTX.sessionId() }); } catch {}
      task.status = status;
      R.plan(el, app);
      emit({
        desc: cb.checked
          ? `marked the goal #${id} "${task.title}" as already handled — they are telling you to SKIP it, not asking you to celebrate it. Move straight on: set the next goal to "doing" and build whatever serves it. One line of acknowledgement at most.`
          : `re-opened the goal #${id} "${task.title}" (back to todo) — they want to actually cover it. Make it the live goal and teach it.`,
        label: `${cb.checked ? 'Skip' : 'Reopen'} · ${short(task.title)}`, icon: 'plan',
      });
    });
  };

  /* ================= sources — the notebook ================= */
  R.sources = (el, app) => {
    const sources = CTX.getSources();
    app.ui = app.ui || { adding: null };
    const kindIco = k => k === 'url' ? '🔗' : k === 'note' ? '✎' : '¶';

    el.innerHTML = `
      <div class="srcs">
        <div class="srcs-list">
          ${sources.length ? sources.map(s => `
            <div class="src" data-s="${s.id}">
              <i>${kindIco(s.kind)}</i>
              <div class="src-main"><b>${esc(s.title)}</b><span>${esc(short(s.content.replace(/\s+/g, ' ').slice(0, 90)))}</span></div>
              <button class="src-del" title="Remove">×</button>
            </div>`).join('')
    : '<div class="srcs-none">Nothing here yet. Add what you\'re studying — I\'ll teach from it.</div>'}
        </div>
        ${app.ui.adding === 'text' ? `
          <div class="src-add">
            <input class="sa-title" placeholder="Title (optional)">
            <textarea class="sa-text" placeholder="Paste your study material…"></textarea>
            <div class="sa-row"><button class="chipbtn" data-a="save-text">Add</button><button class="chipbtn dim" data-a="cancel">Cancel</button></div>
          </div>` : app.ui.adding === 'url' ? `
          <div class="src-add">
            <input class="sa-url" placeholder="https://…">
            <div class="sa-row"><button class="chipbtn" data-a="save-url">Fetch & add</button><button class="chipbtn dim" data-a="cancel">Cancel</button></div>
          </div>` : `
          <div class="sa-row srcs-actions">
            <button class="chipbtn" data-a="add-text">+ Paste text</button>
            <button class="chipbtn" data-a="add-url">+ Add link</button>
          </div>`}
      </div>`;

    const redraw = () => R.sources(el, app);
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'add-text') { app.ui.adding = 'text'; redraw(); el.querySelector('.sa-text')?.focus(); }
      else if (a === 'add-url') { app.ui.adding = 'url'; redraw(); el.querySelector('.sa-url')?.focus(); }
      else if (a === 'cancel') { app.ui.adding = null; redraw(); }
      else if (a === 'save-text') {
        const content = el.querySelector('.sa-text').value.trim();
        if (!content) return;
        const title = el.querySelector('.sa-title').value.trim();
        b.disabled = true;
        try {
          const r = await CTX.api('/api/source', { session_id: CTX.sessionId(), content, title: title || undefined });
          app.ui.adding = null;
          CTX.sourceAdded(r.source);
          emit({ desc: `added a pasted-text source "${r.source.title}" (#${r.source.id}) to the notebook. Fold it into the teaching — re-ground the plan/lesson if it changes things.`, label: `Source · ${short(r.source.title)}`, icon: 'sources' });
        } catch (e) { alert(e.message); b.disabled = false; }
      } else if (a === 'save-url') {
        const url = el.querySelector('.sa-url').value.trim();
        if (!url) return;
        b.disabled = true; b.textContent = 'Fetching…';
        try {
          const r = await CTX.api('/api/source', { session_id: CTX.sessionId(), url });
          app.ui.adding = null;
          CTX.sourceAdded(r.source);
          emit({ desc: `added the link "${r.source.title}" (#${r.source.id}) to the notebook — its text was fetched. Fold it into the teaching.`, label: `Link · ${short(r.source.title)}`, icon: 'sources' });
        } catch (e) { alert(e.message); b.disabled = false; b.textContent = 'Fetch & add'; }
      }
    });
    el.querySelectorAll('.src-del').forEach(b => b.onclick = async () => {
      const id = Number(b.closest('.src').dataset.s);
      try { await CTX.api(`/api/source/${id}`, null, 'DELETE'); } catch {}
      CTX.sourceRemoved(id);
    });
    el.querySelectorAll('.src-main').forEach(d => d.onclick = () => {
      const id = Number(d.closest('.src').dataset.s);
      const s = sources.find(x => x.id === id);
      if (s) emit({ desc: `clicked the notebook source "${s.title}" (#${s.id}). Give a one-line read of what it covers and how it fits the plan.`, label: `Open · ${short(s.title)}`, icon: 'sources' });
    });
  };

  /* ================= lesson ================= */
  R.lesson = (el, app) => {
    if (isDrafting('lesson')) {
      const secs = draftItems('lesson') || [];
      const title = draftHead('lesson').title;
      draftList(el, {
        items: secs,
        head: title ? `<div class="lesson-title">${esc(title)}</div>` : '',
        render: s => `<section class="lesson-sec">
            <h3>${esc(s.heading || '')}${s._partial && !s.body ? caret : ''}</h3>
            <div class="lesson-body">${s._partial && s.body ? mdCaret(s.body) : md(s.body || '')}</div>
          </section>`,
        footer: writingRow(secs.length ? 'writing' : 'writing your lesson'),
      });
      // diagrams appear the moment their fence closes, mid-lesson
      Rich.enhance(el.querySelector('.draft-root'));
      return;
    }
    const art = CTX.currentArtifact('lesson');
    if (!art) return empty(el, 'lesson', 'No lesson yet.');
    const d = art.data;
    el.innerHTML = `
      <div class="lesson">
        <div class="lesson-title">${esc(d.title)}</div>
        ${(d.sections || []).map((s, i) => `
          <section class="lesson-sec" data-i="${i}">
            <h3>${esc(s.heading)}<i title="Go deeper">✦</i></h3>
            <div class="lesson-body">${md(s.body)}</div>
          </section>`).join('')}
      </div>`;
    // mount diagrams, maths, charts and code highlighting on the fresh subtree
    Rich.enhance(el.querySelector('.lesson'));

    el.querySelectorAll('.lesson-sec h3').forEach(h => h.onclick = () => {
      const i = Number(h.closest('.lesson-sec').dataset.i);
      const s = d.sections[i];
      emit({
        desc: `clicked the lesson section "${s.heading}" (lesson "${d.title}", artifact #${art.id}) wanting to go deeper. Expand exactly that: revise the lesson with a deeper treatment of this section (artifact_id=${art.id}) or teach it another way (example, quiz, flashcards) — your call, but make it about "${s.heading}".`,
        label: `Deeper · ${short(s.heading)}`, icon: 'lesson',
      });
    });
  };

  /* ================= quiz ================= */
  R.quiz = (el, app) => {
    /* streaming in: questions appear as they're written */
    if (isDrafting('quiz')) {
      const qs = draftItems('quiz') || [];
      const title = draftHead('quiz').title;
      draftList(el, {
        items: qs,
        head: title ? `<div class="quiz-title">${esc(title)}</div>` : '',
        render: (q, i) => `<div class="qq">
            <div class="qq-p">${i + 1}. ${esc(q.prompt || '')}${q._partial && !q.choices ? caret : ''}</div>
            ${Array.isArray(q.choices) ? `<div class="qq-choices">${q.choices.map(c => `<button class="qq-c" disabled>${esc(c)}</button>`).join('')}</div>`
    : q.type === 'free' ? '<div class="qq-freebox">free answer</div>' : ''}
          </div>`,
        footer: writingRow(qs.length ? 'writing' : 'writing your questions'),
      });
      return;
    }
    const art = CTX.currentArtifact('quiz');
    if (!art) return empty(el, 'quiz', 'No quiz yet.');
    const d = art.data;
    if (!app.ui || app.ui.artId !== art.id) app.ui = { artId: art.id, answers: {}, submitted: null };
    const st = app.ui;

    const res = st.submitted;
    el.innerHTML = `
      <div class="quiz">
        <div class="quiz-title">${esc(d.title)}${res && res.score != null ? `<em class="quiz-score">${res.mcRight}/${res.mc} correct</em>` : ''}</div>
        ${d.questions.map((q, i) => {
    const r = res && res.results[i];
    if (q.type === 'mc') {
      return `<div class="qq" data-i="${i}">
            <div class="qq-p">${i + 1}. ${esc(q.prompt)}</div>
            <div class="qq-choices">${q.choices.map((c, j) => {
        let cls = '';
        if (res) {
          if (j === r.answer_index) cls = 'right';
          else if (st.answers[i] === j && !r.correct) cls = 'wrong';
        } else if (st.answers[i] === j) cls = 'sel';
        return `<button class="qq-c ${cls}" data-j="${j}" ${res ? 'disabled' : ''}>${esc(c)}</button>`;
      }).join('')}</div>
            ${res && r.explain ? `<div class="qq-ex ${r.correct ? 'ok' : 'no'}">${r.correct ? '✓' : '✗'} ${esc(r.explain)}</div>` : ''}
          </div>`;
    }
    return `<div class="qq" data-i="${i}">
          <div class="qq-p">${i + 1}. ${esc(q.prompt)} <em class="qq-free">free answer</em></div>
          <textarea class="qq-t" ${res ? 'disabled' : ''} placeholder="Your answer…">${esc(st.answers[i] || '')}</textarea>
        </div>`;
  }).join('')}
        ${!res ? '<button class="quiz-go chipbtn">Submit answers</button>' : '<div class="quiz-after">Submitted — free answers are being graded in chat.</div>'}
      </div>`;

    el.querySelectorAll('.qq-c').forEach(b => b.onclick = () => {
      if (st.submitted) return;
      const i = Number(b.closest('.qq').dataset.i);
      st.answers[i] = Number(b.dataset.j);
      R.quiz(el, app);
    });
    el.querySelectorAll('.qq-t').forEach(t => t.oninput = () => {
      st.answers[Number(t.closest('.qq').dataset.i)] = t.value;
    });
    const go = el.querySelector('.quiz-go');
    if (go) go.onclick = async () => {
      const answers = d.questions.map((q, i) => st.answers[i] ?? null);
      const unanswered = d.questions.filter((q, i) => answers[i] === null || answers[i] === '').length;
      if (unanswered && !confirm(`${unanswered} unanswered — submit anyway?`)) return;
      go.disabled = true;
      try {
        st.submitted = await CTX.api('/api/quiz-attempt', { artifact_id: art.id, answers });
      } catch (e) { alert(e.message); go.disabled = false; return; }
      R.quiz(el, app);
      const lines = d.questions.map((q, i) => {
        if (q.type === 'mc') {
          const r = st.submitted.results[i];
          return `Q${i + 1} (mc) "${q.prompt}": answered "${q.choices[answers[i]] ?? '—'}" — ${r.correct ? 'CORRECT' : `WRONG (right: "${q.choices[q.answer_index]}")`}`;
        }
        return `Q${i + 1} (free) "${q.prompt}": answered "${answers[i] || '(blank)'}" — GRADE THIS`;
      });
      emit({
        desc: `submitted the quiz "${d.title}" (artifact #${art.id}). Results:\n${lines.join('\n')}\nGrade the free answers specifically (quote what was right/missing), update plan progress, and set up the right next step (reteach what missed, advance what stuck).`,
        label: `Quiz submitted · ${st.submitted.mc ? `${st.submitted.mcRight}/${st.submitted.mc} mc` : 'graded in chat'}`, icon: 'quiz',
      });
    };
  };

  /* ================= flashcards ================= */
  R.flashcards = (el, app) => {
    if (isDrafting('flashcards')) {
      const cards = draftItems('flashcards') || [];
      const title = draftHead('flashcards').title;
      draftList(el, {
        items: cards,
        head: `<div class="fc-topic">${esc(title || 'building the deck')} · ${cards.length} card${cards.length === 1 ? '' : 's'}</div>`,
        render: c => `<div class="fc-draft"><b>${esc(c.q || '')}${c._partial && !c.a ? caret : ''}</b><span>${esc(c.a || '')}${c._partial && c.a ? caret : ''}</span></div>`,
        footer: writingRow('writing cards'),
      });
      return;
    }
    const art = CTX.currentArtifact('flashcards');
    if (!art) return empty(el, 'flashcards', 'No deck yet.');
    const d = art.data;
    if (!app.ui || app.ui.artId !== art.id) app.ui = { artId: art.id, idx: 0, flip: false, got: {}, round: 1 };
    const st = app.ui;
    const cards = d.cards;
    const remaining = cards.map((c, i) => i).filter(i => !st.got[i]);

    if (!remaining.length) {
      el.innerHTML = `
        <div class="fc"><div class="fc-done">
          <b>Deck cleared ✓</b><span>${cards.length} cards · ${st.round} round${st.round > 1 ? 's' : ''}</span>
          <div class="fc-row"><button class="chipbtn" data-a="again">Run it again</button><button class="chipbtn deep" data-a="harder">Make it harder ✦</button></div>
        </div></div>`;
      el.querySelector('[data-a=again]').onclick = () => { app.ui = { artId: art.id, idx: 0, flip: false, got: {}, round: 1 }; R.flashcards(el, app); };
      el.querySelector('[data-a=harder]').onclick = () => emit({
        desc: `cleared the flashcard deck "${d.title}" (artifact #${art.id}, ${cards.length} cards, ${st.round} rounds) and asked for a harder one. Replace it (artifact_id=${art.id}) with a tougher deck building on these, and note the win on the plan.`,
        label: 'Deck cleared · harder ✦', icon: 'flashcards',
      });
      return;
    }

    if (!remaining.includes(st.idx)) st.idx = remaining[0];
    const c = cards[st.idx];
    el.innerHTML = `
      <div class="fc">
        <div class="fc-topic">${esc(d.title)} · ${cards.length - remaining.length}/${cards.length} got it</div>
        <div class="fc-stage"><div class="fc-card ${st.flip ? 'flip' : ''}">
          <div class="fc-face fc-front"><span>Q</span>${esc(c.q)}</div>
          <div class="fc-face fc-back"><span>A</span>${esc(c.a)}</div>
        </div></div>
        <div class="fc-row">
          ${st.flip
    ? '<button class="chipbtn no" data-a="again">Again ↻</button><button class="chipbtn ok" data-a="got">Got it ✓</button>'
    : '<button class="chipbtn" data-a="flip">Flip</button>'}
        </div>
      </div>`;
    const next = () => {
      const rest = cards.map((x, i) => i).filter(i => !st.got[i] && i !== st.idx);
      if (rest.length) { st.idx = rest.find(i => i > st.idx) ?? rest[0]; }
      else st.round++;
      st.flip = false;
      R.flashcards(el, app);
    };
    el.querySelector('.fc-card').onclick = () => { st.flip = !st.flip; R.flashcards(el, app); };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = (ev) => {
      ev.stopPropagation();
      const a = b.dataset.a;
      if (a === 'flip') { st.flip = true; R.flashcards(el, app); }
      else if (a === 'got') { st.got[st.idx] = true; next(); }
      else if (a === 'again') next();
    });
  };

  /* ================= deck =================
     A custom viewer rather than reveal.js: the deck lives in a tile that is
     constantly resized by the grid, and our diagrams are mounted by Rich —
     reveal re-measures hidden slides, which is the documented cause of
     mermaid rendering wrong from slide ~4 on. We need next/prev, notes and
     fullscreen, and that is cheaper to own than to fight. */
  function slideHTML(s) {
    const t = s.title ? `<h2>${esc(s.title)}</h2>` : '';
    switch (s.layout) {
      case 'title':
        return `<div class="sl sl-title"><h1>${esc(s.title || '')}</h1>${s.subtitle ? `<p>${esc(s.subtitle)}</p>` : ''}</div>`;
      case 'quote':
        return `<div class="sl sl-quote"><blockquote>${esc(s.quote || '')}</blockquote>${s.attribution ? `<cite>${esc(s.attribution)}</cite>` : ''}</div>`;
      case 'bullets':
        return `<div class="sl sl-bullets">${t}<ul>${(s.bullets || []).map(b => `<li>${Rich.inline(b)}</li>`).join('')}</ul></div>`;
      case 'split':
        return `<div class="sl sl-split">${t}<div class="sl-cols"><div class="sl-col">${md(s.left || '')}</div><div class="sl-col">${md(s.right || '')}</div></div></div>`;
      case 'image':
        return `<div class="sl sl-image">${t}<div class="sl-body">${md(s.body || '')}</div></div>`;
      default:
        return `<div class="sl sl-focus">${t}<div class="sl-body">${md(s.body || '')}</div></div>`;
    }
  }

  R.deck = (el, app) => {
    if (isDrafting('deck')) {
      const slides = draftItems('deck') || [];
      const title = draftHead('deck').title;
      draftList(el, {
        items: slides,
        head: title ? `<div class="deck-drafthead">${esc(title)}</div>` : '',
        render: (s, i) => `<div class="deck-thumb-row"><em>${i + 1}</em><b>${esc(s.title || s.quote || s.layout || '')}</b><i>${esc(s.layout || '')}</i></div>`,
        footer: writingRow(slides.length ? 'writing slides' : 'planning the deck'),
      });
      return;
    }
    const art = CTX.currentArtifact('deck');
    if (!art) return empty(el, 'deck', 'No deck yet.');
    const d = art.data;
    const slides = d.slides || [];
    if (!slides.length) return empty(el, 'deck', 'This deck has no slides.');
    if (!app.ui || app.ui.artId !== art.id) app.ui = { artId: art.id, i: 0, notes: false };
    const st = app.ui;
    st.i = Math.max(0, Math.min(st.i, slides.length - 1));
    const s = slides[st.i];

    el.innerHTML = `
      <div class="deck">
        <div class="deck-stage">
          <div class="deck-slide">${slideHTML(s)}</div>
        </div>
        ${st.notes && s.notes ? `<div class="deck-notes"><b>Say this</b>${esc(s.notes)}</div>` : ''}
        <div class="deck-bar">
          <button class="dbtn" data-a="prev" ${st.i === 0 ? 'disabled' : ''}>‹</button>
          <div class="deck-dots">${slides.map((x, j) => `<i class="${j === st.i ? 'on' : ''}" data-j="${j}" title="${esc(x.title || x.layout)}"></i>`).join('')}</div>
          <button class="dbtn" data-a="next" ${st.i === slides.length - 1 ? 'disabled' : ''}>›</button>
          <span class="deck-count">${st.i + 1}/${slides.length}</span>
          <button class="dbtn wide ${st.notes ? 'on' : ''}" data-a="notes" title="Speaker notes">notes</button>
          <button class="dbtn wide" data-a="full" title="Present fullscreen">present</button>
        </div>
      </div>`;

    Rich.enhance(el.querySelector('.deck-slide'));

    const go = n => {
      const next = Math.max(0, Math.min(n, slides.length - 1));
      if (next === st.i) return;
      st.i = next;
      R.deck(el, app);
      if (st.i === slides.length - 1) {
        emit({
          desc: `reached the last slide of the deck "${d.title}" (artifact #${art.id}). Ask what they want to do with it, or move the plan on.`,
          label: 'Deck finished', icon: 'deck',
        });
      }
    };
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = ev => {
      ev.stopPropagation();
      const a = b.dataset.a;
      if (a === 'prev') go(st.i - 1);
      else if (a === 'next') go(st.i + 1);
      else if (a === 'notes') { st.notes = !st.notes; R.deck(el, app); }
      else if (a === 'full') {
        const stage = el.querySelector('.deck');
        if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
      }
    });
    el.querySelectorAll('.deck-dots i').forEach(dot => dot.onclick = ev => { ev.stopPropagation(); go(Number(dot.dataset.j)); });

    // arrow keys drive the deck while it has focus (and in fullscreen)
    const stage = el.querySelector('.deck');
    stage.tabIndex = 0;
    stage.onkeydown = ev => {
      if (ev.key === 'ArrowRight' || ev.key === ' ' || ev.key === 'PageDown') { ev.preventDefault(); go(st.i + 1); }
      else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); go(st.i - 1); }
      else if (ev.key === 'Home') go(0);
      else if (ev.key === 'End') go(slides.length - 1);
    };
  };

  /* ================= podcast ================= */
  R.podcast = (el, app) => {
    if (isDrafting('podcast')) {
      const lines = draftItems('podcast') || [];
      const title = draftHead('podcast').title;
      draftList(el, {
        items: lines,
        head: title ? `<div class="pod-title">${esc(title)}</div>` : '',
        render: l => `<div class="pod-ln h${l.host || 'A'}"><em>${esc(l.host || 'A')}</em><span>${esc(l.text || '')}${l._partial ? caret : ''}</span></div>`,
        footer: writingRow('writing the script'),
      });
      return;
    }
    const art = CTX.currentArtifact('podcast');
    if (!art) return empty(el, 'podcast', 'No episode yet.');
    const d = art.data;
    if (!app.ui || app.ui.artId !== art.id) app.ui = { artId: art.id, playing: false, line: 0 };
    const st = app.ui;
    const tts = CTX.ttsEnabled();
    const showLines = el.clientHeight > 170;

    el.innerHTML = `
      <div class="podw">
        <div class="pod">
          <div class="pod-art">${icon('podcast')}</div>
          <div class="pod-info">
            <div class="pod-title">${esc(d.title)}</div>
            <div class="pod-sub">${esc(d.description || `2 hosts · ${d.lines.length} exchanges`)}</div>
            <div class="pod-row">
              <button class="pod-play" ${tts ? '' : 'disabled title="No ELEVENLABS_API_KEY on the server"'}>${st.playing ? '❚❚' : '▶'}</button>
              <div class="pod-track"><i style="width:${Math.round(100 * st.line / Math.max(1, d.lines.length - 1))}%"></i></div>
              <span class="pod-time">${st.line + 1}/${d.lines.length}</span>
            </div>
            ${tts ? '' : '<div class="pod-nott">audio disabled — script below</div>'}
          </div>
        </div>
        ${showLines ? `<div class="pod-lines">${d.lines.map((l, i) => `
          <button class="pod-ln ${i === st.line ? 'on' : ''} h${l.host}" data-i="${i}"><em>${l.host}</em><span>${esc(l.text)}</span></button>`).join('')}</div>` : ''}
      </div>`;

    const audioEl = app._audio || (app._audio = new Audio());
    const stop = () => { st.playing = false; audioEl.pause(); };

    async function playFrom(i) {
      st.playing = true;
      st.line = i;
      R.podcast(el, app);
      try {
        const r = await CTX.api('/api/tts', { artifact_id: art.id, line: i });
        if (!st.playing || st.line !== i) return;
        audioEl.src = r.url;
        await audioEl.play();
        audioEl.onended = () => {
          if (!st.playing) return;
          if (i + 1 < d.lines.length) playFrom(i + 1);
          else {
            st.playing = false;
            R.podcast(el, app);
            emit({ desc: `finished listening to the podcast "${d.title}" (artifact #${art.id}). Suggest the natural next step and update the plan if listening was a task.`, label: 'Episode finished', icon: 'podcast' });
          }
        };
      } catch (e) {
        st.playing = false;
        R.podcast(el, app);
        alert('Audio failed: ' + e.message);
      }
    }
    const playBtn = el.querySelector('.pod-play');
    if (playBtn && tts) playBtn.onclick = () => { st.playing ? (stop(), R.podcast(el, app)) : playFrom(st.line); };
    el.querySelectorAll('.pod-ln').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i);
      if (tts) playFrom(i);
      else { st.line = i; R.podcast(el, app); }
    });
    if (st.playing) {
      const on = el.querySelector('.pod-ln.on');
      if (on) on.scrollIntoView({ block: 'nearest' });
    }
  };

  function render(id, bodyEl, app) {
    (R[id] || (el => empty(el, 'lesson', 'Unknown app')))(bodyEl, app);
  }

  return { REGISTRY, icon, render, configure, md, esc };
});
