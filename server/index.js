/* HTTP entrypoint: static files for the app (public/) and the frozen demo
   (demo/public at /demo/), /api/* to api.js, /demo/api/* to demo/chat.js. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ENV, ROOT } = require('./env.js');
const { open } = require('./db.js');
const { makeStore } = require('./store.js');
const { makeApi } = require('./api.js');
const demo = require('../demo/chat.js');

const PORT = Number(ENV.PORT || 8787);
const PUB = path.join(ROOT, 'public');
const DEMO_PUB = path.join(ROOT, 'demo', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

const db = open();
const store = makeStore(db);
const api = makeApi(store);

/* Asset versioning. Without an explicit Cache-Control the CDN in front of this
   (Cloudflare) applies its own multi-hour TTL to .js/.css — a deploy then ships
   new HTML against stale scripts, which breaks in confusing ways. HTML is never
   cached, so stamping the asset URLs it references makes every deploy land at
   once, and lets the assets themselves be cached hard and safely. */
function assetVersion(dir) {
  let newest = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  try { walk(dir); } catch {}
  return Math.round(newest).toString(36);
}
const VERSION = assetVersion(PUB);

function serveStatic(res, root, file, query) {
  if (file === '/' || file === '') file = '/index.html';
  const full = path.join(root, path.normalize(file));
  if (!full.startsWith(root) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404); res.end('not found');
    return;
  }
  const ext = path.extname(full);
  const type = MIME[ext] || 'application/octet-stream';

  if (ext === '.html') {
    // never cache the entry point; stamp the assets it pulls in
    const html = fs.readFileSync(full, 'utf8')
      .replace(/\b(src|href)="(?!https?:|\/\/)([^"?#]+\.(?:js|css|png))"/g, `$1="$2?v=${VERSION}"`);
    res.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-cache, must-revalidate',
    });
    res.end(html);
    return;
  }

  res.writeHead(200, {
    'content-type': type,
    // a stamped URL is safe to cache hard; an unstamped one must revalidate
    'cache-control': query && query.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate',
  });
  fs.createReadStream(full).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', 'http://x');
    const p = u.pathname;

    /* the frozen sales demo */
    if (p === '/demo') { res.writeHead(301, { location: '/demo/' }); return res.end(); }
    if (p.startsWith('/demo/')) {
      const sub = p.slice('/demo'.length); // '/api/chat', '/', '/app.js', …
      if (sub.startsWith('/api/')) {
        if (await demo.handle(req, res, sub)) return;
        res.writeHead(404); return res.end('not found');
      }
      return serveStatic(res, DEMO_PUB, sub, u.searchParams);
    }

    /* the real app */
    if (p.startsWith('/api/')) {
      const handled = await api.handle(req, res, p, u.searchParams);
      if (handled !== false) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'no such endpoint' }));
    }
    return serveStatic(res, PUB, p, u.searchParams);
  } catch (e) {
    console.error('[http]', e);
    try { res.writeHead(500); res.end('server error'); } catch {}
  }
});

/* A stale older instance holding the port is the one failure that looks like a
   working app: it serves these static files but answers /api/* with its own old
   routes. Say so plainly instead of dumping an EADDRINUSE stack. */
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — most likely an older Chameleon still running.\n` +
      'That instance will serve the current UI but answer the API with its old routes\n' +
      '(you will see "Request failed (502)" in the app). Stop it and start again:\n' +
      `  Windows:  for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT}.*LISTENING') do taskkill /PID %a /F\n` +
      `  macOS/Linux:  kill $(lsof -ti :${PORT})\n`);
    process.exit(1);
  }
  throw e;
});

const audit = require('./log.js');
const images = require('./images.js');

server.listen(PORT, () => {
  console.log(`Chameleon → http://localhost:${PORT}   (demo: /demo/)`);
  console.log(`audit log  → /api/log?t=${audit.TOKEN}&format=text${audit.mintedToken ? '   (set LOG_TOKEN in .env to pin it)' : ''}`);
  const img = images.status();
  console.log(`images     → ${img.configured ? img.provider : 'off (no key)'}`);
  audit.log('boot', { port: PORT, images: img.provider || null });
  if (!ENV.ANTHROPIC_API_KEY) console.warn('WARNING: no ANTHROPIC_API_KEY in .env — the agent will fail.');
  if (!ENV.ELEVENLABS_API_KEY) console.warn('note: no ELEVENLABS_API_KEY — podcast audio disabled.');
});

module.exports = { server, store };
