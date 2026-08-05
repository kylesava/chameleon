/* REST + SSE route handlers for the real app (/api/*). */
const fs = require('fs');
const { runTurn } = require('./agent.js');
const tts = require('./tts.js');
const images = require('./images.js');
const audit = require('./log.js');
const auth = require('./auth.js');
const profileModel = require('./profile.js');
const { ENV } = require('./env.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Bad JSON'); }
}

/* crude but dependency-free HTML → text for URL sources */
function htmlToText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
}

const publicUser = u => ({ id: u.id, username: u.username, display_name: u.display_name });

/* One shape for the profile, everywhere it crosses the wire: what they told us,
   what we concluded, and whether they have been asked yet. The client reads
   `effective` and nothing else. */
const shapeProfile = p => ({
  onboarded: !!p.onboarded,
  stated: profileModel.normalise(p).stated,
  effective: profileModel.derive(p),
});

function makeApi(store) {
  const inflight = new Map(); // session id -> AbortController for the running turn
  const busy = { has: id => inflight.has(id) };

  /* Interruption model (commandment 1): a new turn for a session that is still
     running takes over — abort the old one and wait briefly for it to unwind,
     rather than rejecting the user's message. */
  async function takeover(sessionId) {
    const prev = inflight.get(sessionId);
    if (!prev) return true;
    prev.abort();
    for (let i = 0; i < 60 && inflight.has(sessionId); i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    return !inflight.has(sessionId);
  }

  /* Every API route answers with JSON, including when it fails. Without this
     a malformed body escaped to the generic handler and came back as a
     plain-text 500, which the client then couldn't parse into a message. */
  async function handle(req, res, pathname, query) {
    try {
      return await route(req, res, pathname, query);
    } catch (e) {
      audit.log('api_exception', { path: pathname, method: req.method, message: audit.trim(e.message || String(e), 400) });
      if (res.headersSent) { try { res.end(); } catch {} return; }
      const bad = /bad json|bad status|required|invalid/i.test(e.message || '');
      return json(res, bad ? 400 : 500, { error: e.message || 'server error' });
    }
  }

  async function route(req, res, pathname, query) {
    /* ---------- who is this? ----------
       Everything except login and the log itself needs a session. Profiles
       and journeys are per person, so an anonymous request has nowhere to go. */
    if (req.method === 'POST' && pathname === '/api/login') {
      const b = await readJson(req);
      const name = String(b.username || '').trim().toLowerCase();
      const key = name || 'anon';
      const wait = auth.failDelay(key);
      if (wait) await sleep(wait);
      const user = store.getUserByName(name);
      if (!user || !auth.verifyPassword(b.password || '', user.pass_hash)) {
        auth.noteFail(key);
        audit.log('login_failed', { username: audit.trim(name, 40) });
        return json(res, 401, { error: 'Wrong username or password' });
      }
      auth.noteSuccess(key);
      audit.log('login', { user: user.id, username: user.username });
      res.setHeader('set-cookie', auth.cookieFor(auth.issue(user.id), req));
      return json(res, 200, { user: publicUser(user) });
    }

    if (req.method === 'POST' && pathname === '/api/logout') {
      res.setHeader('set-cookie', auth.clearCookie(req));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && pathname === '/api/me') {
      const uid = auth.userIdFrom(req);
      const user = uid ? store.getUser(uid) : null;
      if (!user) return json(res, 200, { user: null, users: store.listUsers().map(u => u.username) });
      return json(res, 200, { user: publicUser(user), profile: shapeProfile(store.getProfile(user.id)) });
    }

    const userId = auth.userIdFrom(req);
    const isOpen = pathname === '/api/log' || pathname === '/api/client-error';
    if (!userId && !isOpen) return json(res, 401, { error: 'not signed in' });
    const me = userId ? store.getUser(userId) : null;
    if (userId && !me && !isOpen) return json(res, 401, { error: 'unknown session' });

    /* Everything below addresses a journey by id. One guard, applied at every
       entry point, so a stale or guessed id can never reach someone else's
       work. */
    const mine = sid => !!(sid && store.getSession(Number(sid), userId));

    /* ---------- audit trail ----------
       Everything the learner did and the agent did back. Token-gated because
       it contains their words verbatim. */
    if (req.method === 'GET' && pathname === '/api/log') {
      if (query.get('t') !== audit.TOKEN) return json(res, 403, { error: 'bad or missing token' });
      const rows = audit.tail(Number(query.get('n')) || 300, query.get('session'));
      if (query.get('format') === 'text') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(rows.map(r => `${r.t} ${r.event.padEnd(12)} ${JSON.stringify({ ...r, t: undefined, event: undefined })}`).join('\n'));
      }
      return json(res, 200, { count: rows.length, rows });
    }

    /* a failure in the browser is as much a part of the trail as one here */
    if (req.method === 'POST' && pathname === '/api/client-error') {
      const b = await readJson(req).catch(() => ({}));
      audit.log('client_error', {
        session: b.session_id || null,
        where: audit.trim(String(b.where || ''), 80),
        message: audit.trim(String(b.message || ''), 300),
        stack: audit.trim(String(b.stack || ''), 600),
      });
      return json(res, 200, { ok: true });
    }

    /* ---------- bootstrap ---------- */
    if (req.method === 'GET' && pathname === '/api/state') {
      /* A plain load always starts fresh — no resuming half an old lesson.
         (Real persistence arrives with accounts; ?session=N still returns to
         a specific journey, and past ones stay in the switcher.) */
      let session = query.get('session') ? store.getSession(Number(query.get('session')), userId) : null;
      if (!session) {
        store.pruneEmptySessions(null, userId);
        session = store.createSession('New journey', userId);
      }
      const sessions = store.listSessions(userId);
      return json(res, 200, {
        user: publicUser(me),
        profile: shapeProfile(store.getProfile(userId)),
        session: { ...session, layout: JSON.parse(session.layout_json) },
        sessions,
        messages: store.listMessages(session.id),
        plan: store.getPlan(session.id),
        sources: store.listSources(session.id),
        artifacts: store.listArtifacts(session.id),
        tts: tts.enabled(),
        busy: busy.has(session.id),
      });
    }


    if (req.method === 'POST' && pathname === '/api/session') {
      const b = await readJson(req);
      const s = store.createSession(b.title, userId);
      return json(res, 200, { session: s });
    }

    if (req.method === 'POST' && pathname === '/api/session/rename') {
      const b = await readJson(req);
      if (!store.getSession(Number(b.session_id), userId)) return json(res, 404, { error: 'no such journey' });
      store.renameSession(Number(b.session_id), String(b.title || 'Journey'));
      return json(res, 200, { ok: true });
    }

    /* ---------- layout snapshot (user drags/resizes/closes) ---------- */
    if (req.method === 'POST' && pathname === '/api/layout') {
      const b = await readJson(req);
      if (!store.getSession(Number(b.session_id), userId)) return json(res, 404, { error: 'no such journey' });
      store.saveLayout(Number(b.session_id), b.layout || []);
      return json(res, 200, { ok: true });
    }

    /* ---------- how this person likes to work ---------- */
    if (req.method === 'POST' && pathname === '/api/profile') {
      const b = await readJson(req);
      const current = store.getProfile(userId);
      const saved = store.saveProfile(userId, {
        ...current,
        onboarded: b.onboarded !== undefined ? !!b.onboarded : current.onboarded,
        stated: { ...current.stated, ...(b.stated || {}) },
      });
      audit.log('profile_set', { user: userId, stated: JSON.stringify(saved.stated) });
      return json(res, 200, { profile: shapeProfile(saved) });
    }

    /* Behaviour feeding the profile — closing a window straight after it opened,
       asking to slow down, pressing Continue. */
    if (req.method === 'POST' && pathname === '/api/signal') {
      const b = await readJson(req);
      const saved = store.recordSignal(userId, b.session_id || null, String(b.kind || ''), b.detail || '', b.value);
      return json(res, 200, { profile: shapeProfile(saved) });
    }

    /* Seeding hook for the browser tests: lets a test put a known plan on
       screen without spending an agent turn. Off unless CHAMELEON_TEST is set,
       so it does not exist in production. */
    if (ENV.CHAMELEON_TEST && req.method === 'POST' && pathname === '/api/test/plan') {
      const b = await readJson(req);
      if (!mine(b.session_id)) return json(res, 404, { error: 'no such journey' });
      const tasks = (b.tasks || []).map((t, i) => ({ ...t, status: t.status || (i === 0 ? 'doing' : 'todo') }));
      return json(res, 200, { plan: store.setPlan(Number(b.session_id), String(b.title || 'Plan'), tasks) });
    }

    /* The learner saying "I'm ready" — the explicit advance in guided mode. */
    if (req.method === 'POST' && pathname === '/api/step') {
      const b = await readJson(req);
      const sid = Number(b.session_id);
      if (!store.getSession(sid, userId)) return json(res, 404, { error: 'no such journey' });
      if (b.action === 'current' && b.task_id) {
        return json(res, 200, { plan: store.setCurrentTask(sid, Number(b.task_id)) });
      }
      const r = store.advancePlan(sid);
      if (!r) return json(res, 409, { error: 'no plan yet' });
      store.recordSignal(userId, sid, 'advance');
      if (r.completed) store.recordSignal(userId, sid, 'step_completed');
      return json(res, 200, { plan: r.plan, completed: r.completed, next: r.next });
    }

    /* ---------- the agent turn (SSE) ---------- */
    if (req.method === 'POST' && pathname === '/api/chat') {
      const b = await readJson(req);
      const sessionId = Number(b.session_id);
      const session = store.getSession(sessionId, userId);
      if (!session) return json(res, 404, { error: 'no such session' });
      if (!b.content || typeof b.content !== 'string') return json(res, 400, { error: 'content required' });
      if (!(await takeover(sessionId))) return json(res, 409, { error: 'previous turn is still stopping — try again' });

      const ac = new AbortController();
      inflight.set(sessionId, ac);
      req.on('close', () => ac.abort()); // the stop button: client aborts the fetch
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      const emit = o => { try { res.write(`data: ${JSON.stringify(o)}\n\n`); } catch {} };
      // A long thinking phase can emit nothing for a while; proxies (Cloudflare)
      // drop idle connections. SSE comments keep it alive and are ignored by the client.
      const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
      const tlog = audit.turn(sessionId);

      // name the journey after what it turned out to be about
      if (/^(New|First) journey$/.test(session.title) && !store.listMessages(sessionId, 1).length) {
        const words = String(b.content).replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ');
        if (words) store.renameSession(sessionId, words.length > 52 ? words.slice(0, 52) + '…' : words);
      }

      const layout = {
        get: () => JSON.parse(store.getSession(sessionId).layout_json),
        set: l => store.saveLayout(sessionId, l),
      };
      try {
        await runTurn({
          store, sessionId,
          userContent: String(b.content).slice(0, 24000),
          kind: b.kind === 'event' ? 'event' : 'chat',
          // what the learner should see for this event in the transcript —
          // the raw description is written for the model, not for them
          label: b.label ? String(b.label).slice(0, 120) : null,
          emit, signal: ac.signal, layout, tlog,
          effective: profileModel.derive(store.getProfile(userId)),
          onStepComplete: () => store.recordSignal(userId, sessionId, 'step_completed'),
          /* The learner coaching the product from the chat. Writes to the same
             profile the settings sheet edits — one source of truth, whether
             they said it or clicked it. */
          setPreference: (patch, because) => {
            const current = store.getProfile(userId);
            const stated = { ...current.stated, ...patch };
            if (patch.apps) stated.apps = { ...(current.stated || {}).apps, ...patch.apps };
            store.saveProfile(userId, { ...current, stated });
            audit.log('preference_learned', {
              user: userId, session: sessionId,
              patch: JSON.stringify(patch), because: audit.trim(String(because || ''), 160),
            });
            return { note: 'their settings sheet now shows this too' };
          },
        });
        emit({ t: 'done' });
      } catch (e) {
        if (ac.signal.aborted) { tlog.log('aborted'); emit({ t: 'done', interrupted: true }); }
        else {
          tlog.error('turn', e);
          console.error('[chat]', e);
          emit({ t: 'err', m: e.message });
        }
      } finally {
        clearInterval(heartbeat);
        if (inflight.get(sessionId) === ac) inflight.delete(sessionId);
        try { res.end(); } catch {}
      }
      return;
    }

    /* ---------- notebook sources ---------- */
    if (req.method === 'POST' && pathname === '/api/source') {
      const b = await readJson(req);
      const sessionId = Number(b.session_id);
      if (!mine(sessionId)) return json(res, 404, { error: 'no such journey' });
      let src;
      if (b.url) {
        let url;
        try { url = new URL(b.url); } catch { return json(res, 400, { error: 'bad url' }); }
        if (!/^https?:$/.test(url.protocol)) return json(res, 400, { error: 'http(s) only' });
        try {
          const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'chameleon/1.0' } });
          if (!r.ok) return json(res, 502, { error: `fetch failed (${r.status})` });
          const html = await r.text();
          const title = (html.match(/<title[^>]*>([^<]{1,200})/i) || [])[1]?.trim() || url.hostname;
          const text = htmlToText(html).slice(0, 40000);
          if (!text) return json(res, 422, { error: 'no readable text at that URL' });
          src = store.addSource(sessionId, 'url', b.title || title, `${url.href}\n\n${text}`);
        } catch (e) {
          return json(res, 502, { error: `fetch failed: ${e.message}` });
        }
      } else {
        if (!b.content || !String(b.content).trim()) return json(res, 400, { error: 'content or url required' });
        src = store.addSource(sessionId, 'text', b.title || 'Pasted text', String(b.content).slice(0, 100000));
      }
      return json(res, 200, { source: src });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/source/')) {
      const id = Number(pathname.split('/').pop());
      const src = store.getSource(id);
      if (!src || !mine(src.session_id)) return json(res, 404, { error: 'no such source' });
      store.deleteSource(id);
      return json(res, 200, { ok: true });
    }

    /* ---------- the plan: tick, rename, remove, add ----------
       These apply immediately and do NOT start an agent turn — steering your
       own goals should never mean waiting. The agent sees the updated plan in
       the next turn's state digest. */
    if (req.method === 'POST' && pathname === '/api/task') {
      const b = await readJson(req);
      const sessionId = Number(b.session_id);
      if (!mine(sessionId)) return json(res, 404, { error: 'no such journey' });
      let task = null;
      if (b.status) task = store.setTaskStatus(Number(b.task_id), String(b.status));
      else if (b.title !== undefined || b.detail !== undefined) task = store.updateTask(Number(b.task_id), b);
      else return json(res, 400, { error: 'nothing to change' });
      if (!task) return json(res, 404, { error: 'no such task' });
      return json(res, 200, { task, plan: store.getPlan(sessionId) });
    }
    if (req.method === 'DELETE' && pathname.startsWith('/api/task/')) {
      const id = Number(pathname.split('/').pop());
      const sid = Number(query.get('session'));
      if (!mine(sid)) return json(res, 404, { error: 'no such journey' });
      const ok = store.deleteTask(id);
      return json(res, ok ? 200 : 404, ok ? { ok: true, plan: sid ? store.getPlan(sid) : null } : { error: 'no such task' });
    }
    if (req.method === 'POST' && pathname === '/api/task/new') {
      const b = await readJson(req);
      if (!b.title || !String(b.title).trim()) return json(res, 400, { error: 'title required' });
      if (!mine(b.session_id)) return json(res, 404, { error: 'no such journey' });
      const task = store.addTask(Number(b.session_id), b.title, { stage: b.stage, detail: b.detail });
      if (!task) return json(res, 409, { error: 'no plan yet' });
      return json(res, 200, { task, plan: store.getPlan(Number(b.session_id)) });
    }

    /* ---------- quiz attempts (mc auto-grade; free answers go to the agent) ---------- */
    if (req.method === 'POST' && pathname === '/api/quiz-attempt') {
      const b = await readJson(req);
      const art = store.getArtifact(Number(b.artifact_id));
      if (!art || art.app !== 'quiz' || !mine(art.session_id)) return json(res, 404, { error: 'no such quiz' });
      const answers = Array.isArray(b.answers) ? b.answers : [];
      let mc = 0, mcRight = 0;
      const results = art.data.questions.map((q, i) => {
        if (q.type !== 'mc') return { type: 'free' };
        mc++;
        const ok = Number(answers[i]) === q.answer_index;
        if (ok) mcRight++;
        return { type: 'mc', correct: ok, answer_index: q.answer_index, explain: q.explain || '' };
      });
      const score = mc ? mcRight / mc : null;
      store.addAttempt(art.id, answers, score);
      if (score !== null) store.recordSignal(userId, art.session_id, 'quiz_score', art.title, score);
      store.recordSignal(userId, art.session_id, 'app_used', 'quiz');
      return json(res, 200, { score, mc, mcRight, results });
    }

    /* ---------- TTS ---------- */
    if (req.method === 'POST' && pathname === '/api/tts') {
      const b = await readJson(req);
      const art = store.getArtifact(Number(b.artifact_id));
      if (!art || art.app !== 'podcast' || !mine(art.session_id)) return json(res, 404, { error: 'no such podcast' });
      const line = art.data.lines[Number(b.line)];
      if (!line) return json(res, 400, { error: 'bad line index' });
      try {
        const hash = await tts.synthesize(line.host, line.text);
        return json(res, 200, { url: `api/audio/${hash}` });
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    /* ---------- generated illustration ----------
       Resolved lazily from the client so a lesson isn't held up while several
       images render; each lands in place as it finishes. */
    if (req.method === 'POST' && pathname === '/api/image') {
      if (!images.enabled()) return json(res, 501, { error: 'image generation not configured' });
      const b = await readJson(req);
      try {
        const hash = await images.generate(b.prompt, b.aspect);
        return json(res, 200, { url: `api/image/${hash}` });
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    if (req.method === 'GET' && pathname.startsWith('/api/image/')) {
      const hash = pathname.split('/').pop();
      if (!/^[a-f0-9]{64}$/.test(hash)) return json(res, 400, { error: 'bad hash' });
      const found = images.imageFile(hash);
      if (!found) return json(res, 404, { error: 'not generated' });
      res.writeHead(200, { 'content-type': found.mime, 'cache-control': 'public, max-age=31536000, immutable' });
      fs.createReadStream(found.path).pipe(res);
      return;
    }

    if (req.method === 'GET' && pathname.startsWith('/api/audio/')) {
      const hash = pathname.split('/').pop();
      if (!/^[a-f0-9]{64}$/.test(hash)) return json(res, 400, { error: 'bad hash' });
      const file = tts.audioPath(hash);
      if (!fs.existsSync(file)) return json(res, 404, { error: 'not synthesized' });
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000, immutable' });
      fs.createReadStream(file).pipe(res);
      return;
    }

    return false; // not an API route
  }

  return { handle, busy };
}

module.exports = { makeApi, htmlToText };
