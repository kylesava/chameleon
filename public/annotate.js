/* Annotations: talk to the agent about a specific thing on screen.

   Matt's spec, near enough verbatim:

     "In any app I should be able to click on parts of an app — highlight a
      sentence, click a card, click a box. It's almost like an annotation on
      top of the app. Once I make that interaction I get a little text box
      where I can type a message to the agent: make this shorter, change this
      to blue, what the hell does this mean? So it's not just instructions, it
      could be questions as well… I can send a single annotation if it's a
      showstopper, or mark up a whole document and submit all of those changes
      in one go."

   So: selecting text or clicking an element inside a tile marks it, and a
   small composer appears anchored to it. Each note is either sent on its own
   or added to a batch and submitted together — the learner picks, every time.
   The agent receives them as one message quoting exactly what was marked. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Annotate = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /* An event target is not always an element — mouseup can land on the
     document or a text node, and calling closest() on those throws and kills
     the listener. */
  const within = (t, sel) => {
    const el = t && (t.nodeType === 1 ? t : t.parentElement);
    return !!(el && el.closest && el.closest(sel));
  };

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const short = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  let CTX = { send: () => {}, appName: id => id };
  const configure = o => { CTX = { ...CTX, ...o }; };

  /* Notes waiting to be sent, oldest first. */
  const batch = [];
  let composer = null;      // the open note box, if any
  let target = null;        // { app, quote, rect }

  /* ---------------- what was marked ---------------- */

  function tileOf(node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el ? el.closest('.tile') : null;
  }

  /* A selection inside a tile is the clearest annotation there is. */
  function fromSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const text = sel.toString().trim();
    if (text.length < 2) return null;
    const tile = tileOf(sel.anchorNode);
    if (!tile) return null;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { app: tile.dataset.app, quote: text, rect: r };
  }

  /* Otherwise: the smallest sensible thing they clicked — a slide, a card, a
     row, a paragraph. Falling back to the whole tile would be useless. */
  const PICKABLE = '.qq, .plan-task, .fc-card, .sl, .src-row, .lesson-sec, li, tr, p, h3, h4, blockquote, figure, table, pre';
  function fromClick(e) {
    const tile = tileOf(e.target);
    if (!tile) return null;
    const from = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    const el = from && from.closest(PICKABLE);
    if (!el || !tile.contains(el)) return null;
    const text = (el.innerText || '').trim();
    if (!text) return null;
    return { app: tile.dataset.app, quote: text, rect: el.getBoundingClientRect(), el };
  }

  /* ---------------- the note box ---------------- */

  function close() {
    if (composer) composer.remove();
    composer = null;
    target = null;
    document.querySelectorAll('.annot-mark').forEach(m => m.classList.remove('annot-mark'));
  }

  function open(t) {
    close();
    target = t;
    if (t.el) t.el.classList.add('annot-mark');

    composer = document.createElement('div');
    composer.className = 'annot';
    composer.innerHTML = `
      <div class="annot-quote">${esc(short(t.quote))}</div>
      <textarea class="annot-input" rows="1" placeholder="Make this shorter, or ask what it means…" maxlength="600"></textarea>
      <div class="annot-actions">
        <button class="annot-add" title="Mark this up and keep going">Add to batch</button>
        <button class="annot-send">Send</button>
      </div>`;
    document.body.appendChild(composer);
    place(composer, t.rect);

    const input = composer.querySelector('.annot-input');
    input.focus();
    input.oninput = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; };
    input.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { close(); return; }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(true); }
    };
    composer.querySelector('.annot-send').onclick = () => commit(true);
    composer.querySelector('.annot-add').onclick = () => commit(false);
    composer.onclick = ev => ev.stopPropagation();
  }

  /* Keep it on screen and next to the thing it is about. */
  function place(el, rect) {
    const w = 268, gap = 10;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(12, Math.min(left, innerWidth - w - 12));
    let top = rect.bottom + gap;
    if (top + 150 > innerHeight) top = Math.max(12, rect.top - 150 - gap);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.style.width = `${w}px`;
  }

  function commit(sendNow) {
    if (!composer || !target) return;
    const note = composer.querySelector('.annot-input').value.trim();
    if (!note) { close(); return; }
    batch.push({ app: target.app, quote: target.quote, note });
    close();
    window.getSelection().removeAllRanges();
    if (sendNow) submit(); else renderBatch();
  }

  /* ---------------- the batch ---------------- */

  function renderBatch() {
    let bar = document.getElementById('annot-bar');
    if (!batch.length) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'annot-bar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = `
      <span class="ab-count">${batch.length} mark${batch.length === 1 ? '' : 's'}</span>
      <div class="ab-list">${batch.map((b, i) =>
    `<button class="ab-item" data-i="${i}" title="Remove">${esc(short(b.note, 34))}<i>×</i></button>`).join('')}</div>
      <button class="ab-send">Send all</button>`;
    bar.querySelectorAll('.ab-item').forEach(b => b.onclick = () => {
      batch.splice(Number(b.dataset.i), 1);
      renderBatch();
    });
    bar.querySelector('.ab-send').onclick = submit;
  }

  /* One message, quoting exactly what was marked, so the agent can act on the
     right thing without guessing. */
  function submit() {
    if (!batch.length) return;
    const notes = batch.splice(0, batch.length);
    renderBatch();

    const byApp = notes.reduce((m, n) => { (m[n.app] = m[n.app] || []).push(n); return m; }, {});
    const desc = ['marked up what is on screen and wants these changes. Work through EVERY one, in order, and revise the artifact in place (pass its artifact_id) rather than making a new one. Where a note is a question rather than an instruction, answer it — do not silently edit.'];
    for (const [app, list] of Object.entries(byApp)) {
      desc.push(`\nIn the ${CTX.appName(app)}:`);
      list.forEach((n, i) => desc.push(`${i + 1}. On "${short(n.quote, 160)}" — ${n.note}`));
    }
    const label = notes.length === 1
      ? `Marked up · ${short(notes[0].note, 26)}`
      : `${notes.length} marks · ${CTX.appName(notes[0].app)}`;
    CTX.send({ desc: desc.join('\n'), label, icon: 'pointer' });
  }

  /* ---------------- wiring ---------------- */

  function start() {
    /* A selection anywhere inside a tile offers a note. Mouseup rather than
       selectionchange, so it fires once they have finished dragging. */
    document.addEventListener('mouseup', e => {
      if (within(e.target, '.annot, #annot-bar')) return;
      setTimeout(() => {
        const t = fromSelection();
        if (t) open(t);
      }, 10);
    });

    /* Alt-click marks the smallest thing under the cursor. A plain click has
       to stay a plain click — the apps are interactive. */
    document.addEventListener('click', e => {
      if (within(e.target, '.annot, #annot-bar')) return;
      if (!e.altKey) { if (!window.getSelection().toString().trim()) close(); return; }
      const t = fromClick(e);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      open(t);
    }, true);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && composer) { e.stopPropagation(); close(); }
    });
    window.addEventListener('resize', close);
  }

  return { configure, start, pending: () => batch.length, _submit: submit, _open: open };
});
