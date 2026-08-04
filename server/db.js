/* node:sqlite storage (Node 24+). One DB file, one process — never run two
   app instances against it. Schema is created idempotently at open. */
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./env.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS session (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL DEFAULT 'New journey',
  layout_json TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS message (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES session(id),
  role       TEXT NOT NULL,                   -- user | assistant
  kind       TEXT NOT NULL DEFAULT 'chat',    -- chat | narration | event
  app        TEXT,                            -- narration target app
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id, id);
CREATE TABLE IF NOT EXISTS plan (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES session(id),
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS plan_task (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plan(id),
  ord     INTEGER NOT NULL,
  stage   INTEGER NOT NULL DEFAULT 0,         -- same stage = parallel; stages run in order
  title   TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  status  TEXT NOT NULL DEFAULT 'todo'        -- todo | doing | done
);
CREATE TABLE IF NOT EXISTS source (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES session(id),
  kind       TEXT NOT NULL DEFAULT 'text',    -- text | url | note
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS artifact (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES session(id),
  app        TEXT NOT NULL,                   -- lesson | flashcards | quiz | podcast
  title      TEXT NOT NULL,
  data       TEXT NOT NULL,                   -- JSON payload the renderer consumes
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS quiz_attempt (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id INTEGER NOT NULL REFERENCES artifact(id),
  answers     TEXT NOT NULL,                  -- JSON array, index-aligned with questions
  score       REAL,                           -- fraction of auto-gradable questions correct
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function open(file) {
  const dbPath = file || path.join(ROOT, 'data', 'chameleon.db');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { open };
