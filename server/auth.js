/* Demo-grade auth: enough to keep two people's profiles and journeys apart.
   scrypt-hashed passwords, signed cookie sessions. No reset flow, no email —
   see docs/ADAPTIVE.md for what this deliberately is not. */
const crypto = require('crypto');
const { ENV } = require('./env.js');

const SECRET = ENV.AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const mintedSecret = !ENV.AUTH_SECRET;
const COOKIE = 'cham_sid';
const MAX_AGE = 30 * 24 * 3600; // seconds

/* ---- passwords ---- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [saltHex, keyHex] = String(stored).split(':');
    if (!saltHex || !keyHex) return false;
    const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(keyHex, 'hex');
    return key.length === expected.length && crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

/* ---- cookie sessions ---- */
const sign = payload => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function issue(userId) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function read(token) {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = sign(payload);
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  const [id, issued] = payload.split('.');
  if (!id || !issued) return null;
  if (Date.now() - Number(issued) > MAX_AGE * 1000) return null;
  return Number(id);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* Secure only when the request actually arrived over TLS. Hard-coding it would
   break every http://localhost test run; omitting it would send the session
   token in the clear if anyone ever reached the box directly. The tunnel sets
   x-forwarded-proto. */
const secureFor = req => (/^https$/i.test(String(req && req.headers && req.headers['x-forwarded-proto'] || '')) ? '; Secure' : '');
const cookieFor = (token, req) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secureFor(req)}`;
const clearCookie = req => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFor(req)}`;

/* The app is served under /cmln in production, so the cookie path stays "/"
   and the browser sends it for both. */
function userIdFrom(req) {
  return read(parseCookies(req.headers.cookie)[COOKIE]);
}

/* ---- brute-force damping ----
   Not a real rate limiter; just enough that guessing is tedious. */
const attempts = new Map();
function failDelay(key) {
  const n = attempts.get(key) || 0;
  return Math.min(n * 250, 2000);
}
function noteFail(key) { attempts.set(key, (attempts.get(key) || 0) + 1); }
function noteSuccess(key) { attempts.delete(key); }

module.exports = {
  hashPassword, verifyPassword, issue, read, userIdFrom,
  cookieFor, clearCookie, parseCookies, COOKIE,
  failDelay, noteFail, noteSuccess, mintedSecret, SECRET,
};
