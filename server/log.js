/* Append-only interaction log so a hosted session can be audited after the
   fact — what the learner did, what the agent did back, what failed and how
   long it took. One JSON object per line, rotated by size. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ENV, ROOT } = require('./env.js');

const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'audit.jsonl');
const MAX_BYTES = 8 * 1024 * 1024;

/* Reading the log means reading everything the learner typed, so it is never
   open: a token from .env, or one minted at boot and printed to the console. */
const TOKEN = ENV.LOG_TOKEN || crypto.randomBytes(9).toString('base64url');
const mintedToken = !ENV.LOG_TOKEN;

let stream = null;
function out() {
  if (!stream) {
    fs.mkdirSync(DIR, { recursive: true });
    try {
      if (fs.existsSync(FILE) && fs.statSync(FILE).size > MAX_BYTES) {
        fs.renameSync(FILE, FILE + '.1');
      }
    } catch {}
    stream = fs.createWriteStream(FILE, { flags: 'a' });
  }
  return stream;
}

const trim = (v, n) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + `…[+${v.length - n}]` : v);

function log(event, data = {}) {
  const row = { t: new Date().toISOString(), event, ...data };
  try { out().write(JSON.stringify(row) + '\n'); } catch {}
  return row;
}

/* One turn's worth of context, so its lines can be correlated. */
function turn(sessionId) {
  const id = crypto.randomBytes(4).toString('hex');
  const t0 = Date.now();
  const counts = { tools: 0, errors: 0 };
  return {
    id,
    log(event, data = {}) { return log(event, { turn: id, session: sessionId, ms: Date.now() - t0, ...data }); },
    tool(name, input) {
      counts.tools++;
      return this.log('tool', { name, input: trim(JSON.stringify(input || {}), 600) });
    },
    toolResult(name, result, ok) {
      if (!ok) counts.errors++;
      return this.log('tool_result', { name, ok, result: trim(String(result), 300) });
    },
    error(where, e) {
      counts.errors++;
      return this.log('error', { where, message: trim(e && e.message ? e.message : String(e), 500) });
    },
    end(extra = {}) { return this.log('turn_end', { ...counts, ...extra }); },
  };
}

function tail(n = 200, sessionId = null) {
  try {
    const raw = fs.readFileSync(FILE, 'utf8').trim();
    if (!raw) return [];
    let rows = raw.split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (sessionId) rows = rows.filter(r => r.session === Number(sessionId));
    return rows.slice(-n);
  } catch { return []; }
}

module.exports = { log, turn, tail, TOKEN, mintedToken, FILE, trim };
