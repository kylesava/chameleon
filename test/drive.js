/* A tiny Chrome DevTools Protocol driver — zero dependencies, node's global
   WebSocket only. Enough to click through the real UI in a real browser, which
   is the only way to catch the class of bug that unit tests never see.

   Usage:
     const b = await open({ headless: true });
     const p = await b.page('http://localhost:8787/');
     await p.click('#gate-user'); await p.type('matt');
     await p.shot('out.png');
     await b.close();
*/
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Chrome writes the port it actually bound to as the first line of
   DevToolsActivePort, once it is listening. */
async function readDevToolsPort(dir, tries = 100) {
  const file = join(dir, 'DevToolsActivePort');
  for (let i = 0; i < tries; i++) {
    try {
      const raw = String(readFileSync(file, 'utf8'));
      const first = raw.split(String.fromCharCode(10))[0].trim();
      if (/^[0-9]+$/.test(first)) return Number(first);
    } catch { /* not written yet */ }
    await sleep(100);
  }
  throw new Error('chrome never reported a debugging port');
}

async function fetchJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`chrome devtools never came up at ${url}`);
}

async function open({ headless = true, width = 1440, height = 900, port = 0 } = {}) {
  const bin = CHROME.find(p => { try { return existsSync(p); } catch { return false; } })
    || CHROME[0];
  const dir = mkdtempSync(join(tmpdir(), 'cham-cdp-'));
  /* Port 0 lets the OS pick a free one and Chrome writes it to
     DevToolsActivePort in the profile directory. Deriving it from the pid
     meant two test files running at once could attach to each other's browser
     — which looks exactly like a flaky test and is not one. */
  const p = port || 0;
  const args = [
    `--remote-debugging-port=${p}`,
    `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--hide-scrollbars',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  const proc = spawn(bin, args, { stdio: 'ignore' });

  const realPort = p || await readDevToolsPort(dir);
  const version = await fetchJson(`http://127.0.0.1:${realPort}/json/version`);
  const browser = await connect(version.webSocketDebuggerUrl);

  return {
    proc, port: realPort,
    async page(url) { return newPage(browser, p, url, { width, height }); },
    async close() {
      try { await browser.send('Browser.close'); } catch { /* already gone */ }
      try { proc.kill(); } catch { /* already gone */ }
      await sleep(150);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
    },
  };
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message + (m.error.data ? ` — ${m.error.data}` : '')));
        else res(m.result);
      } else if (m.method) {
        for (const fn of listeners) fn(m);
      }
    };
    ws.onerror = e => reject(new Error('cdp socket error: ' + (e.message || 'unknown')));
    ws.onopen = () => resolve({
      send(method, params, sessionId) {
        const mid = ++id;
        return new Promise((res, rej) => {
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
          setTimeout(() => {
            if (pending.has(mid)) { pending.delete(mid); rej(new Error(`cdp timeout: ${method}`)); }
          }, 30000);
        });
      },
      on(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
      close() { try { ws.close(); } catch { /* */ } },
    });
  });
}

async function newPage(browser, port, url, size) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);

  const console_ = [];
  const errors = [];
  const requests = [];
  browser.on(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ');
      console_.push({ type: m.params.type, text });
      if (m.params.type === 'error') errors.push(text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push(d.exception?.description || d.text);
    }
    if (m.method === 'Network.responseReceived') {
      requests.push({ url: m.params.response.url, status: m.params.response.status });
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false,
  });

  const evalIn = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('page eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  };

  const page = {
    sessionId, console: console_, errors, requests,
    async goto(u) {
      await send('Page.navigate', { url: u });
      await page.waitFor('document.readyState === "complete"', 15000);
      await sleep(120);
    },
    eval: evalIn,
    /* Wait for a JS expression to become truthy. */
    async waitFor(expr, ms = 8000, label) {
      const t0 = Date.now();
      for (;;) {
        let v;
        try { v = await evalIn(`(() => { try { return !!(${expr}); } catch { return false; } })()`, false); } catch { v = false; }
        if (v) return true;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label || expr}`);
        await sleep(100);
      }
    },
    async has(sel) { return evalIn(`!!document.querySelector(${JSON.stringify(sel)})`, false); },
    async text(sel) {
      return evalIn(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText || ''`, false);
    },
    async count(sel) { return evalIn(`document.querySelectorAll(${JSON.stringify(sel)}).length`, false); },
    async box(sel) {
      return evalIn(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return null; const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom }; })()`, false);
    },
    /* Real mouse events at the element's centre — catches z-index/pointer-events
       bugs that a synthetic .click() would sail straight past. */
    async click(sel, { real = true } = {}) {
      await page.waitFor(`document.querySelector(${JSON.stringify(sel)})`, 8000, `selector ${sel}`);
      /* Bring it into view first, the way a person would — otherwise a control
         inside a scrolling panel is "missing" when it is merely below the fold,
         and real mouse coordinates land on whatever is there instead. */
      await evalIn(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
        if (!e) return; const r = e.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); })()`, false);
      await sleep(120);
      const b = await page.box(sel);
      if (!b || b.w === 0) throw new Error(`cannot click ${sel} — zero-size or missing`);
      const x = Math.round(b.x + b.w / 2), y = Math.round(b.y + b.h / 2);
      if (!real) { await evalIn(`document.querySelector(${JSON.stringify(sel)}).click()`, false); return; }
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
      }
      await sleep(60);
    },
    /* What element is actually on top at this point? Use it to prove nothing
       is covering a control. */
    async topAt(sel) {
      return evalIn(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
        const r = e.getBoundingClientRect();
        const t = document.elementFromPoint(Math.round(r.x + r.width/2), Math.round(r.y + r.height/2));
        if (!t) return null;
        return { tag: t.tagName.toLowerCase(), id: t.id, cls: t.className, covered: !e.contains(t) && t !== e }; })()`, false);
    },
    async type(text) {
      for (const ch of String(text)) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch });
      }
      await sleep(30);
    },
    async fill(sel, text) {
      await page.click(sel);
      await evalIn(`document.querySelector(${JSON.stringify(sel)}).value = ''`, false);
      await page.type(text);
    },
    async key(name) {
      const map = { Enter: { windowsVirtualKeyCode: 13, text: '\r' }, Escape: { windowsVirtualKeyCode: 27 }, Tab: { windowsVirtualKeyCode: 9 } };
      const k = map[name] || {};
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, ...k });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, ...k });
      await sleep(50);
    },
    async drag(from, to) {
      const b = await page.box(from);
      const x0 = Math.round(b.x + b.w / 2), y0 = Math.round(b.y + b.h / 2);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1, buttons: 1 });
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1,
          x: Math.round(x0 + (to.x - x0) * (i / steps)), y: Math.round(y0 + (to.y - y0) * (i / steps)),
        });
        await sleep(16);
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0 });
      await sleep(120);
    },
    async shot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    /* Every element that overflows the viewport horizontally — the signature of
       a layout bug. */
    async overflowing() {
      return evalIn(`(() => { const out = [];
        for (const e of document.querySelectorAll('body *')) {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const s = getComputedStyle(e);
          if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') continue;
          if (r.right > innerWidth + 2 || r.left < -2 || r.bottom > innerHeight + 400)
            out.push({ sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : ''),
                       left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom) });
        }
        return out.slice(0, 20); })()`, false);
    },
    /* Which app windows the chat surface is sitting on top of. The dock floats
       over the canvas, so the canvas has to reserve room for it — when it does
       not, content is silently unreadable underneath. */
    async coveredTiles() {
      return evalIn(`(() => {
        /* The transcript is the canvas and app windows sit ON it, so the dock
           overlapping a tile is the design. What must never be covered is the
           composer — the agent's own container. */
        const dock = document.getElementById('chat-form') || document.getElementById('chatdock');
        if (!dock) return [];
        const d = dock.getBoundingClientRect();
        if (!d.width || !d.height) return [];
        const out = [];
        for (const t of document.querySelectorAll('.tile')) {
          const r = t.getBoundingClientRect();
          const w = Math.min(r.right, d.right) - Math.max(r.left, d.left);
          const h = Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top);
          if (w > 4 && h > 4) out.push({ app: t.dataset.app || t.className, w: Math.round(w), h: Math.round(h) });
        }
        return out; })()`, false);
    },
    async close() { try { await browser.send('Target.closeTarget', { targetId }); } catch { /* */ } },
  };

  if (url) await page.goto(url);
  return page;
}

/* Start the app on a scratch port with its own database so tests never touch
   the real one. */
async function serve({ port = 0, db } = {}) {
  /* Port 0 by default: the OS picks a free one and the server reports it on
     stdout. Fixed ports meant a server left behind by a killed run was still
     listening, the next run attached to it, and the test then ran against
     someone else's database — which reads as a flaky test and is not one. */
  const dir = mkdtempSync(join(tmpdir(), 'cham-db-'));
  const env = { ...process.env, PORT: String(port), CHAMELEON_DB: db || join(dir, 'test.db'), CHAMELEON_TEST: '1' };
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: join(__dirname, '..'),
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', d => { log += d; });
  proc.stderr.on('data', d => { log += d; });

  let bound = 0;
  for (let i = 0; i < 120; i++) {
    if (proc.exitCode !== null) throw new Error(`server exited (${proc.exitCode}):
${log}`);
    const m = log.match(/http:\/\/localhost:(\d+)/);
    if (m) { bound = Number(m[1]); break; }
    await sleep(120);
  }
  if (!bound) throw new Error(`server never reported a port:
${log}`);

  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${bound}/api/me`, { signal: AbortSignal.timeout(1500) });
      if (r.status) break;
    } catch { /* not answering yet */ }
    await sleep(120);
  }

  return {
    proc, port: bound, url: `http://localhost:${bound}`,
    log: () => log,
    async close() {
      try { proc.kill(); } catch { /* already gone */ }
      await sleep(200);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ }
    },
  };
}

/* Onboarding no longer asks anything — everyone lands on the same sensible
   pace. Tests that need a specific one set it the way the settings sheet does
   and reload, rather than driving a screen that is deliberately gone. */
const PACE = ['slow-walk', 'walk', 'run', 'sprint'];
async function pickPace(page, mode = 'walk') {
  await page.waitFor('!document.getElementById("gate")', 25000, 'the gate to dismiss');
  await page.waitFor('window.__cham && window.__cham.sessionId()', 15000, 'boot');
  if (mode === 'walk') return;   // already the default
  await page.eval(`fetch('api/profile', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ onboarded: true, mode: '${mode}' }) }).then(r => r.json())`);
  await page.eval('location.reload()', false);
  await page.waitFor('window.__cham && window.__cham.sessionId()', 20000, 'reload');
}

module.exports = { open, serve, sleep, PACE, pickPace };
