/* .env loader shared by the app and the frozen demo. Process env wins. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch {}
  for (const k of Object.keys(process.env)) out[k] = process.env[k];
  return out;
}

const ENV = loadEnv();

module.exports = { ENV, ROOT };
