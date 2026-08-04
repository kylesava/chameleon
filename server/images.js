/* Generated illustration for lessons and slides, with an on-disk cache.
   Primary: Google Gemini via the Interactions API (JSON in, base64 out — a
   single synchronous call, which suits a zero-dependency server). Falls back
   to OpenAI images if only that key is present. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ENV, ROOT } = require('./env.js');

const GEMINI_KEY = ENV.GEMINI_API_KEY || ENV.GOOGLE_API_KEY;
const OPENAI_KEY = ENV.OPENAI_API_KEY;
const GEMINI_MODEL = ENV.IMAGE_MODEL_GEMINI || 'gemini-3.1-flash-image';
const OPENAI_MODEL = ENV.IMAGE_MODEL_OPENAI || 'gpt-image-2';
const IMG_DIR = path.join(ROOT, 'data', 'images');

/* One house style so a lesson or deck hangs together visually. The renderer
   is dark, so the image must be born dark rather than cut out. */
const STYLE = [
  'Editorial conceptual illustration, not photorealistic.',
  'Solid near-black background (#10141b) filling the entire frame, edge to edge.',
  'Restrained palette: desaturated blue (#5d87ff), teal-green (#3ce2a5) and warm amber (#f0a83c) against the dark ground.',
  'Clean flat vector-adjacent shapes with soft volumetric glow and subtle film grain.',
  'High contrast, generous negative space, centred composition.',
  'Absolutely no text, no words, no letters, no numbers, no labels, no captions, no watermarks.',
].join(' ');

const ASPECTS = { '16:9': '16:9', '4:3': '4:3', '1:1': '1:1', '3:2': '3:2', '9:16': '9:16' };
const OPENAI_SIZE = { '16:9': '1536x1024', '3:2': '1536x1024', '4:3': '1536x1024', '1:1': '1024x1024', '9:16': '1024x1536' };

/* A key alone is not capability. If the provider says the account can't pay,
   or the key is rejected, keep offering illustrations and every lesson comes
   back peppered with placeholders that can never resolve — worse than not
   having the feature. One such failure switches it off for this process. */
let brokenReason = null;
const FATAL = /credits are depleted|billing|quota|API key not valid|permission denied|unauthor/i;

const configured = () => !!(GEMINI_KEY || OPENAI_KEY);
const enabled = () => configured() && !brokenReason;
const provider = () => (GEMINI_KEY ? 'gemini' : OPENAI_KEY ? 'openai' : null);
const status = () => ({ configured: configured(), enabled: enabled(), provider: provider(), reason: brokenReason });

function hashKey(prompt, aspect) {
  return crypto.createHash('sha256').update(`v3|${provider()}|${aspect}|${prompt}|${STYLE}`).digest('hex');
}
/* Providers differ on format — Gemini's image endpoint serves JPEG, OpenAI
   PNG — so the cache stores whichever came back and the route looks for both. */
const EXTS = ['jpg', 'png'];
const MIME = { jpg: 'image/jpeg', png: 'image/png' };
function imageFile(hash) {
  for (const ext of EXTS) {
    const p = path.join(IMG_DIR, `${hash}.${ext}`);
    if (fs.existsSync(p)) return { path: p, mime: MIME[ext] };
  }
  return null;
}
const imagePath = (hash, ext = 'jpg') => path.join(IMG_DIR, `${hash}.${ext}`);

async function viaGemini(prompt, aspect) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: [{ type: 'text', text: `${prompt}\n\n${STYLE}` }],
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',     // the only format this endpoint accepts
        aspect_ratio: ASPECTS[aspect] || '16:9',
        image_size: '1K',            // capital K is required
      },
      generation_config: { thinking_level: 'minimal' }, // thinking bills by default
    }),
  });
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const j = await res.json();
  const b64 = j.output_image?.data
    || (j.steps || []).flatMap(s => s.content || []).find(c => c.type === 'image')?.data;
  if (!b64) throw new Error('Gemini returned no image');
  return Buffer.from(b64, 'base64');
}

async function viaOpenAI(prompt, aspect) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_KEY}`, 'content-type': 'application/json' },
    // note: gpt-image-* always returns base64; response_format is DALL·E-only
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt: `${prompt}\n\n${STYLE}`,
      size: OPENAI_SIZE[aspect] || '1536x1024',
      quality: 'medium',
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 240)}`);
  const j = await res.json();
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return Buffer.from(b64, 'base64');
}

const inflight = new Map(); // identical prompts asked for twice share one call

async function generate(prompt, aspect = '16:9') {
  if (!enabled()) throw new Error('No image API key (set GEMINI_API_KEY or OPENAI_API_KEY in .env)');
  const clean = String(prompt || '').trim().slice(0, 900);
  if (!clean) throw new Error('empty prompt');
  const hash = hashKey(clean, aspect);
  if (imageFile(hash)) return hash;
  if (inflight.has(hash)) return inflight.get(hash);

  const job = (async () => {
    try {
      const buf = GEMINI_KEY ? await viaGemini(clean, aspect) : await viaOpenAI(clean, aspect);
      const file = imagePath(hash, GEMINI_KEY ? 'jpg' : 'png');
      fs.mkdirSync(IMG_DIR, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, file);
      return hash;
    } catch (e) {
      if (FATAL.test(e.message || '')) {
        brokenReason = e.message.slice(0, 200);
        console.warn(`\n[images] disabled for this run — ${brokenReason}\n`);
      }
      throw e;
    }
  })().finally(() => inflight.delete(hash));

  inflight.set(hash, job);
  return job;
}

module.exports = { enabled, configured, provider, status, generate, imagePath, imageFile, STYLE };
