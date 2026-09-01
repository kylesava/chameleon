/* Annotations: mark something in an app, say what you want, send it — alone or
   batched. Matt's spec is that this works in ANY app, on text or on an element,
   and that the learner chooses whether a note goes now or waits for the rest. */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { open, serve, sleep, pickPace } = require('./drive.js');

const SHOTS = path.join(__dirname, '..', 'data', 'shots');

async function signIn(p, mode = 'sprint') {
  await p.waitFor('document.querySelector("#gate-form")', 15000, 'login');
  await p.fill('#gate-user', 'kyle');
  await p.fill('#gate-pass', 'YoungGuy');
  await p.click('#gate-form button');
  await p.waitFor('!document.getElementById("gate")', 20000, 'gate');
  await p.waitFor('window.__cham && window.__cham.sessionId()', 12000, 'boot');
}

/* A lesson tile with known content, without spending an agent turn. */
const SEED = `(() => {
  const t = document.createElement('div');
  t.className = 'tile';
  t.dataset.app = 'lesson';
  t.style.cssText = 'position:fixed;left:40px;top:90px;width:520px;height:340px;z-index:5';
  t.innerHTML = '<div class="tile-body"><div class="lesson">' +
    '<section class="lesson-sec"><h3>Simple versus compound</h3>' +
    '<p id="para-a">Simple interest is always calculated on the original amount.</p>' +
    '<p id="para-b">Compound interest is calculated on whatever the balance is now.</p>' +
    '</section></div></div>';
  document.body.appendChild(t);
})()`;

test('annotate: select text in an app, say what you want, send it', { timeout: 150000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(SEED, false);

  /* selecting inside a tile offers a note anchored to what was selected */
  await p.eval(`(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('para-a'));
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  })()`, false);
  await p.waitFor('document.querySelector(".annot")', 6000, 'the note box');
  assert.match(await p.text('.annot-quote'), /original amount/i,
    'the note must quote exactly what was marked');
  await p.shot(SHOTS + '/annot-note.png');

  /* nothing about it is off screen */
  const b = await p.box('.annot');
  assert.ok(b.left >= 0 && b.right <= 1440 && b.top >= 0 && b.bottom <= 900,
    `the note box must stay on screen (${JSON.stringify(b)})`);

  /* typing and sending fires one agent event that carries the quote */
  await p.eval(`(() => {
    window.__sent = [];
    document.addEventListener('chameleon:event', e => window.__sent.push(e.detail));
  })()`, false);
  await p.click('.annot-input');
  await p.type('make this shorter');
  await p.click('.annot-send');
  await sleep(400);

  const sent = await p.eval('window.__sent');
  assert.equal(sent.length, 1, 'one send, one message');
  assert.match(sent[0].desc, /marked up what is on screen/i);
  assert.match(sent[0].desc, /original amount/i, 'the agent is told what was marked');
  assert.match(sent[0].desc, /make this shorter/i, 'and what they asked for');
  assert.match(sent[0].desc, /Lesson/, 'and which app it was in');
  assert.equal(await p.has('.annot'), false, 'the box closes after sending');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('annotate: batch several marks and send them together', { timeout: 150000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(SEED, false);
  await p.eval(`(() => { window.__sent = [];
    document.addEventListener('chameleon:event', e => window.__sent.push(e.detail)); })()`, false);

  const mark = async (id, note, send) => {
    await p.eval(`(() => {
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('${id}'));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })()`, false);
    await p.waitFor('document.querySelector(".annot-input")', 6000, 'the note box');
    await p.click('.annot-input');
    await p.type(note);
    await p.click(send ? '.annot-send' : '.annot-add');
    await sleep(350);
  };

  await mark('para-a', 'make this shorter', false);
  assert.ok(await p.has('#annot-bar'), 'a held note shows in the batch bar');
  assert.match(await p.text('.ab-count'), /1 mark/);
  assert.equal((await p.eval('window.__sent')).length, 0, 'and nothing is sent yet');

  await mark('para-b', 'what does this actually mean?', false);
  assert.match(await p.text('.ab-count'), /2 marks/);
  await p.shot(SHOTS + '/annot-batch.png');

  /* one of them can be dropped before sending */
  await p.click('.ab-item[data-i="0"]');
  await sleep(300);
  assert.match(await p.text('.ab-count'), /1 mark/, 'a mark can be removed before it goes');

  await mark('para-a', 'and tighten this one', false);
  await p.click('.ab-send');
  await sleep(400);

  const sent = await p.eval('window.__sent');
  assert.equal(sent.length, 1, 'a batch is ONE message, not one per mark');
  assert.match(sent[0].desc, /what does this actually mean/i);
  assert.match(sent[0].desc, /tighten this one/i, 'every held note must be in it');
  assert.ok(!/make this shorter/.test(sent[0].desc), 'and the removed one must not be');
  assert.match(sent[0].desc, /1\./, 'numbered so the agent works through them in order');
  assert.equal(await p.has('#annot-bar'), false, 'the bar clears once sent');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});

test('annotate: alt-click marks an element, and ordinary clicks still work', { timeout: 150000 }, async t => {
  const app = await serve();
  const br = await open({ headless: true });
  const p = await br.page(app.url + '/');
  t.after(async () => { await br.close(); await app.close(); });

  await signIn(p);
  await p.eval(SEED, false);
  await p.eval(`(() => { window.__clicks = 0;
    document.getElementById('para-b').addEventListener('click', () => window.__clicks++); })()`, false);

  /* a plain click must stay a plain click — the apps are interactive */
  await p.click('#para-b');
  await sleep(250);
  assert.equal(await p.eval('window.__clicks', false), 1, 'ordinary clicks reach the app');
  assert.equal(await p.has('.annot'), false, 'and do not open a note');

  /* alt-click marks the smallest sensible thing under the cursor */
  await p.eval(`(() => {
    const el = document.getElementById('para-b');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  })()`, false);
  await p.waitFor('document.querySelector(".annot")', 6000, 'the note box');
  assert.match(await p.text('.annot-quote'), /balance is now/i);
  assert.ok(await p.has('.annot-mark'), 'and the thing marked is visibly marked');

  /* escape abandons it cleanly */
  await p.key('Escape');
  await sleep(300);
  assert.equal(await p.has('.annot'), false);
  assert.equal(await p.count('.annot-mark'), 0, 'and the marking is cleared');

  assert.deepEqual(p.errors.filter(e => !/favicon/.test(e)), [], 'no uncaught page errors');
});
