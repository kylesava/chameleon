/* All reads/writes. Takes a DatabaseSync handle so tests can use :memory:. */

function makeStore(db) {
  const S = {};

  /* ---- sessions ---- */
  S.createSession = (title) => {
    const r = db.prepare('INSERT INTO session (title) VALUES (?)').run(title || 'New journey');
    return S.getSession(Number(r.lastInsertRowid));
  };
  S.getSession = (id) => db.prepare('SELECT * FROM session WHERE id = ?').get(id);
  S.listSessions = () => db.prepare('SELECT id, title, created_at, updated_at FROM session ORDER BY updated_at DESC').all();
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
    const ins = db.prepare('INSERT INTO plan_task (plan_id, ord, stage, title, detail, status) VALUES (?, ?, ?, ?, ?, ?)');
    (tasks || []).forEach((t, i) =>
      ins.run(planId, i, Number.isInteger(t.stage) ? t.stage : 0, String(t.title || 'Task'), String(t.detail || ''), t.status === 'done' || t.status === 'doing' ? t.status : 'todo'));
    return S.getPlan(sessionId);
  };
  S.getPlan = (sessionId) => {
    const plan = db.prepare('SELECT * FROM plan WHERE session_id = ? ORDER BY id DESC LIMIT 1').get(sessionId);
    if (!plan) return null;
    const tasks = db.prepare('SELECT * FROM plan_task WHERE plan_id = ? ORDER BY stage, ord').all(plan.id);
    return { id: plan.id, title: plan.title, tasks };
  };
  S.setTaskStatus = (taskId, status) => {
    if (!['todo', 'doing', 'done'].includes(status)) throw new Error('bad status');
    db.prepare('UPDATE plan_task SET status = ? WHERE id = ?').run(status, taskId);
    return db.prepare('SELECT * FROM plan_task WHERE id = ?').get(taskId);
  };
  S.getTask = (taskId) => db.prepare('SELECT * FROM plan_task WHERE id = ?').get(taskId);

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
