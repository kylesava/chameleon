/* All reads/writes. Takes a DatabaseSync handle so tests can use :memory:. */

const auth = require('./auth.js');
const profileModel = require('./profile.js');

function makeStore(db) {
  const S = {};

  /* ---- users ---- */
  S.createUser = (username, password, displayName) => {
    const r = db.prepare('INSERT INTO user (username, pass_hash, display_name, profile_json) VALUES (?, ?, ?, ?)')
      .run(String(username).toLowerCase(), auth.hashPassword(password), displayName || username, JSON.stringify(profileModel.normalise({})));
    return S.getUser(Number(r.lastInsertRowid));
  };
  S.getUser = (id) => db.prepare('SELECT * FROM user WHERE id = ?').get(id);
  S.getUserByName = (username) => db.prepare('SELECT * FROM user WHERE username = ?').get(String(username || '').toLowerCase());
  S.listUsers = () => db.prepare('SELECT id, username, display_name FROM user ORDER BY id').all();
  S.setPassword = (id, password) => db.prepare('UPDATE user SET pass_hash = ? WHERE id = ?').run(auth.hashPassword(password), id);

  S.getProfile = (userId) => {
    const u = S.getUser(userId);
    if (!u) return null;
    try { return profileModel.normalise(JSON.parse(u.profile_json)); }
    catch { return profileModel.normalise({}); }
  };
  S.saveProfile = (userId, profile) => {
    const p = profileModel.normalise(profile);
    db.prepare('UPDATE user SET profile_json = ? WHERE id = ?').run(JSON.stringify(p), userId);
    return p;
  };
  /* Record a behavioural signal and fold it into the profile in one step, so
     the two can never drift apart. */
  S.recordSignal = (userId, sessionId, kind, detail = '', value = null) => {
    const num = value === null || value === undefined ? null : Number(value);
    db.prepare('INSERT INTO signal (user_id, session_id, kind, detail, value) VALUES (?, ?, ?, ?, ?)')
      .run(userId, sessionId || null, String(kind), String(detail).slice(0, 200), Number.isFinite(num) ? num : null);
    /* Some signals name a thing rather than measure one — "app_used: quiz"
       carries its meaning in `detail`, not in a number. Fall back to it so the
       caller does not have to know which kind is which. */
    const carried = num === null ? (detail || 1) : num;
    return S.saveProfile(userId, profileModel.applySignal(S.getProfile(userId), kind, carried));
  };
  S.listSignals = (userId, limit = 100) =>
    db.prepare('SELECT * FROM signal WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);

  /* ---- sessions (journeys), always scoped to a user ---- */
  S.createSession = (title, userId = null) => {
    const r = db.prepare('INSERT INTO session (title, user_id) VALUES (?, ?)').run(title || 'New journey', userId);
    return S.getSession(Number(r.lastInsertRowid));
  };
  S.getSession = (id, userId = null) => {
    const s = db.prepare('SELECT * FROM session WHERE id = ?').get(id);
    if (!s) return undefined;
    if (userId != null && s.user_id != null && s.user_id !== userId) return undefined; // not yours
    return s;
  };
  S.listSessions = (userId = null) => userId == null
    ? db.prepare('SELECT id, title, created_at, updated_at FROM session ORDER BY updated_at DESC').all()
    : db.prepare('SELECT id, title, created_at, updated_at FROM session WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
  /* Every page load starts a fresh journey (accounts will change this), so
     abandoned blank ones would pile up in the switcher. Drop the ones that
     never became anything. */
  S.pruneEmptySessions = (exceptId = null, userId = null) => {
    const rows = db.prepare(`
      SELECT s.id FROM session s
      WHERE s.id != COALESCE(?, -1)
        AND (? IS NULL OR s.user_id = ?)
        AND NOT EXISTS (SELECT 1 FROM message  WHERE session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM artifact WHERE session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM source   WHERE session_id = s.id)
        AND NOT EXISTS (SELECT 1 FROM plan     WHERE session_id = s.id)
    `).all(exceptId, userId, userId);
    const del = db.prepare('DELETE FROM session WHERE id = ?');
    for (const r of rows) del.run(r.id);
    return rows.length;
  };
  S.touchSession = (id) => db.prepare("UPDATE session SET updated_at = datetime('now') WHERE id = ?").run(id);
  S.renameSession = (id, title) => db.prepare('UPDATE session SET title = ? WHERE id = ?').run(title, id);
  S.saveLayout = (id, layout) => db.prepare('UPDATE session SET layout_json = ? WHERE id = ?').run(JSON.stringify(layout || []), id);

  /* ---- messages ---- */
  S.addMessage = (sessionId, role, content, kind = 'chat', app = null) => {
    const r = db.prepare('INSERT INTO message (session_id, role, kind, app, content) VALUES (?, ?, ?, ?, ?)')
      .run(sessionId, role, kind, app, content);
    S.touchSession(sessionId);
    return Number(r.lastInsertRowid);
  };
  S.listMessages = (sessionId, limit = 200) =>
    db.prepare('SELECT * FROM (SELECT * FROM message WHERE session_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
      .all(sessionId, limit);

  /* ---- plan ---- */
  S.setPlan = (sessionId, title, tasks) => {
    const r = db.prepare('INSERT INTO plan (session_id, title) VALUES (?, ?)').run(sessionId, title);
    const planId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO plan_task (plan_id, ord, stage, title, detail, status, done_when, apps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    (tasks || []).forEach((t, i) =>
      ins.run(planId, i, Number.isInteger(t.stage) ? t.stage : 0,
        String(t.title || 'Task'), String(t.detail || ''),
        t.status === 'done' || t.status === 'doing' ? t.status : 'todo',
        String(t.done_when || '').slice(0, 300),
        Array.isArray(t.apps) ? t.apps.join(',') : String(t.apps || '')));
    return S.getPlan(sessionId);
  };
  S.getPlan = (sessionId) => {
    const plan = db.prepare('SELECT * FROM plan WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId);
    if (!plan) return null;
    const tasks = db.prepare('SELECT * FROM plan_task WHERE plan_id = ? ORDER BY stage, ord').all(plan.id)
      .map(t => ({ ...t, apps: t.apps ? String(t.apps).split(',').filter(Boolean) : [] }));
    return { id: plan.id, title: plan.title, tasks };
  };
  S.setTaskStatus = (taskId, status) => {
    if (!['todo', 'doing', 'done'].includes(status)) throw new Error('bad status');
    db.prepare('UPDATE plan_task SET status = ? WHERE id = ?').run(status, taskId);
    return db.prepare('SELECT * FROM plan_task WHERE id = ?').get(taskId);
  };
  S.getTask = (taskId) => db.prepare('SELECT * FROM plan_task WHERE id = ?').get(taskId);
  /* Exactly one step is live at a time — that is the whole point of the spine,
     so it is enforced here rather than hoped for in a prompt. */
  S.setCurrentTask = (sessionId, taskId) => {
    const plan = S.getPlan(sessionId);
    if (!plan) return null;
    const ids = plan.tasks.map(t => t.id);
    if (!ids.includes(Number(taskId))) return null;
    db.prepare("UPDATE plan_task SET status = 'todo' WHERE plan_id = ? AND status = 'doing'").run(plan.id);
    db.prepare("UPDATE plan_task SET status = 'doing' WHERE id = ?").run(taskId);
    return S.getPlan(sessionId);
  };
  S.currentTask = (sessionId) => {
    const plan = S.getPlan(sessionId);
    return plan ? plan.tasks.find(t => t.status === 'doing') || null : null;
  };
  /* Complete the live step and light the next one that isn't done. */
  S.advancePlan = (sessionId) => {
    const plan = S.getPlan(sessionId);
    if (!plan) return null;
    const cur = plan.tasks.find(t => t.status === 'doing');
    if (cur) db.prepare("UPDATE plan_task SET status = 'done' WHERE id = ?").run(cur.id);
    const next = plan.tasks.find(t => t.status === 'todo' && (!cur || t.id !== cur.id));
    if (next) db.prepare("UPDATE plan_task SET status = 'doing' WHERE id = ?").run(next.id);
    return { plan: S.getPlan(sessionId), completed: cur || null, next: next || null };
  };
  S.updateTask = (taskId, fields) => {
    const t = S.getTask(taskId);
    if (!t) return null;
    const title = fields.title !== undefined ? String(fields.title).trim().slice(0, 300) : t.title;
    const detail = fields.detail !== undefined ? String(fields.detail).trim().slice(0, 500) : t.detail;
    const doneWhen = fields.done_when !== undefined ? String(fields.done_when).trim().slice(0, 300) : t.done_when;
    if (!title) return t; // never let a goal lose its name
    db.prepare('UPDATE plan_task SET title = ?, detail = ?, done_when = ? WHERE id = ?').run(title, detail, doneWhen, taskId);
    return S.getTask(taskId);
  };
  S.deleteTask = (taskId) => {
    const t = S.getTask(taskId);
    if (!t) return false;
    db.prepare('DELETE FROM plan_task WHERE id = ?').run(taskId);
    return true;
  };
  S.addTask = (sessionId, title, opts = {}) => {
    const plan = db.prepare('SELECT * FROM plan WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId);
    if (!plan) return null;
    const last = db.prepare('SELECT MAX(ord) AS o, MAX(stage) AS s FROM plan_task WHERE plan_id = ?').get(plan.id);
    const r = db.prepare('INSERT INTO plan_task (plan_id, ord, stage, title, detail, status, done_when, apps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(plan.id, (last.o ?? -1) + 1, Number.isInteger(opts.stage) ? opts.stage : (last.s ?? 0),
        String(title).trim().slice(0, 300), String(opts.detail || '').slice(0, 500), 'todo',
        String(opts.done_when || '').slice(0, 300), '');
    return S.getTask(Number(r.lastInsertRowid));
  };

  /* ---- sources ---- */
  S.addSource = (sessionId, kind, title, content) => {
    const r = db.prepare('INSERT INTO source (session_id, kind, title, content) VALUES (?, ?, ?, ?)')
      .run(sessionId, kind, title, content);
    return db.prepare('SELECT * FROM source WHERE id = ?').get(Number(r.lastInsertRowid));
  };
  S.listSources = (sessionId) => db.prepare('SELECT * FROM source WHERE session_id = ? ORDER BY id').all(sessionId);
  S.getSource = (id) => db.prepare('SELECT * FROM source WHERE id = ?').get(id);
  S.deleteSource = (id) => db.prepare('DELETE FROM source WHERE id = ?').run(id);

  /* ---- artifacts ---- */
  S.saveArtifact = (sessionId, app, title, data, id = null) => {
    if (id) {
      db.prepare("UPDATE artifact SET title = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND session_id = ?")
        .run(title, JSON.stringify(data), id, sessionId);
      return S.getArtifact(id);
    }
    const r = db.prepare('INSERT INTO artifact (session_id, app, title, data) VALUES (?, ?, ?, ?)')
      .run(sessionId, app, title, JSON.stringify(data));
    return S.getArtifact(Number(r.lastInsertRowid));
  };
  S.getArtifact = (id) => {
    const a = db.prepare('SELECT * FROM artifact WHERE id = ?').get(id);
    if (!a) return null;
    return { ...a, data: JSON.parse(a.data) };
  };
  S.listArtifacts = (sessionId) =>
    db.prepare('SELECT * FROM artifact WHERE session_id = ? ORDER BY id').all(sessionId)
      .map(a => ({ ...a, data: JSON.parse(a.data) }));
  S.latestArtifact = (sessionId, app) => {
    const a = db.prepare('SELECT * FROM artifact WHERE session_id = ? AND app = ? ORDER BY id DESC LIMIT 1').get(sessionId, app);
    return a ? { ...a, data: JSON.parse(a.data) } : null;
  };

  /* ---- quiz attempts ---- */
  S.addAttempt = (artifactId, answers, score) => {
    const r = db.prepare('INSERT INTO quiz_attempt (artifact_id, answers, score) VALUES (?, ?, ?)')
      .run(artifactId, JSON.stringify(answers), score);
    return Number(r.lastInsertRowid);
  };
  S.listAttempts = (artifactId) =>
    db.prepare('SELECT * FROM quiz_attempt WHERE artifact_id = ? ORDER BY id').all(artifactId)
      .map(a => ({ ...a, answers: JSON.parse(a.answers) }));

  return S;
}

module.exports = { makeStore };
