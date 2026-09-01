/* ElevenLabs text-to-speech with an on-disk cache.
   Podcast audio is synthesized per script line on demand; identical
   (voice, text) pairs hit the cache forever after. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { ENV, ROOT } = require('./env.js');

const API_KEY = ENV.ELEVENLABS_API_KEY;
const TTS_MODEL = ENV.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';
// Two premade ElevenLabs voices for the podcast hosts (override in .env).
const VOICES = {
  A: ENV.ELEVENLABS_VOICE_A || '21m00Tcm4TlvDq8ikWAM', // Rachel
  B: ENV.ELEVENLABS_VOICE_B || 'pNInz6obpgDQGcFmaJgB', // Adam
};
const AUDIO_DIR = path.join(ROOT, 'data', 'audio');

const enabled = () => !!API_KEY;

function hashKey(voiceId, text) {
  return crypto.createHash('sha256').update(`${TTS_MODEL}|${voiceId}|${text}`).digest('hex');
}

function audioPath(hash) {
  return path.join(AUDIO_DIR, `${hash}.mp3`);
}

/* Synthesize one line; returns the cache hash (serve via /api/audio/<hash>). */
async function synthesize(host, text) {
  if (!API_KEY) throw new Error('Missing ELEVENLABS_API_KEY (put it in .env)');
  const voiceId = VOICES[host] || VOICES.A;
  const hash = hashKey(voiceId, text);
  const file = audioPath(hash);
  if (fs.existsSync(file)) return hash;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs error ${res.status}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return hash;
}

module.exports = { enabled, synthesize, audioPath, hashKey, VOICES };
