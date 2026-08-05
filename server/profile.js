/* The learner profile: what they told us, what they actually do, and the
   settings the agent is finally handed. See docs/ADAPTIVE.md for why this
   exists — Matt and Kyle wanted opposite experiences from the same build. */

const PACES = ['guided', 'blended', 'firehose'];
const CHECKINS = ['every-step', 'every-stage', 'rarely'];
const DEPTHS = ['concise', 'balanced', 'thorough'];
const MODALITIES = ['reading', 'diagrams', 'practice', 'audio'];
/* Where the agent's voice lives. The workspace is the product; the transcript
   is a record of it. Some people want the teaching beside the thing being
   taught, some want it in a conversation, some want both. */
const VOICES = ['windows', 'both', 'chat'];
const CHATTER = ['minimal', 'normal', 'full'];
const VISUALS = ['plain', 'diagrams', 'rich'];
/* Where the spine lives. In chat it is something you talk to the agent about;
   in a window it is a thing beside the work. Matt wants the first. */
const PLAN_PLACES = ['chat', 'window'];

/* ONE control, and everything hangs off it.
   Matt: "I love that we've got those [settings]. I don't love that we expose
   them to users… I felt like there should be just a slider — how crazy do you
   want to go. And all of the parameters hang off just one."
   So a mode is a named bundle of every other setting. The individual settings
   still exist, are still tracked, and are still changeable behind Advanced —
   touching one just means you are no longer on a preset. */
const MODES = {
  simple: {
    label: 'One thing at a time',
    parallelism: 1, checkins: 'every-step', planPlace: 'chat',
    voice: 'chat', chatter: 'full', depth: 'balanced', visuals: 'diagrams',
  },
  balanced: {
    label: 'A steady pace',
    parallelism: 2, checkins: 'every-stage', planPlace: 'chat',
    voice: 'both', chatter: 'normal', depth: 'balanced', visuals: 'diagrams',
  },
  extreme: {
    label: 'Everything at once',
    parallelism: 4, checkins: 'rarely', planPlace: 'window',
    voice: 'windows', chatter: 'minimal', depth: 'concise', visuals: 'rich',
  },
};
const MODE_KEYS = Object.keys(MODES);
const TUNED = ['parallelism', 'checkins', 'planPlace', 'voice', 'chatter', 'depth', 'visuals'];

/* Which preset a set of settings corresponds to, or 'custom'. Derived rather
   than stored, so hand-tuning and coaching cannot leave the label lying. */
function modeOf(stated) {
  for (const k of MODE_KEYS) {
    if (TUNED.every(f => String(MODES[k][f]) === String(stated[f]))) return k;
  }
  return 'custom';
}
const TEACHABLE = ['lesson', 'quiz', 'flashcards', 'podcast', 'deck'];

const DEFAULT_STATED = {
  pace: 'blended',
  parallelism: 2,
  checkins: 'every-stage',
  depth: 'balanced',
  modality: { reading: 2, diagrams: 2, practice: 2, audio: 1 },
  priorKnowledge: 'some',
  voice: 'windows',
  chatter: 'minimal',
  planPlace: 'chat',
  visuals: 'diagrams',
  // which windows the agent may build in at all — off means never offered
  apps: { lesson: true, quiz: true, flashcards: true, podcast: true, deck: true },
};

const DEFAULT_OBSERVED = {
  stepsCompleted: 0,
  tilesClosedFast: 0,
  advanceRequests: 0,
  slowDownSignals: 0,
  speedUpSignals: 0,
  quizzesTaken: 0,
  quizAccuracySum: 0,
  modalityUse: {},
  lastUpdated: null,
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function normalise(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const s = { ...DEFAULT_STATED, ...(p.stated || {}) };
  return {
    version: 1,
    onboarded: !!p.onboarded,
    stated: {
      pace: oneOf(s.pace, PACES, 'blended'),
      parallelism: clamp(Number(s.parallelism) || 2, 1, 4),
      checkins: oneOf(s.checkins, CHECKINS, 'every-stage'),
      depth: oneOf(s.depth, DEPTHS, 'balanced'),
      modality: { ...DEFAULT_STATED.modality, ...(s.modality || {}) },
      priorKnowledge: oneOf(s.priorKnowledge, ['novice', 'some', 'strong'], 'some'),
      voice: oneOf(s.voice, VOICES, 'windows'),
      planPlace: oneOf(s.planPlace, PLAN_PLACES, 'chat'),
      chatter: oneOf(s.chatter, CHATTER, 'minimal'),
      visuals: oneOf(s.visuals, VISUALS, 'diagrams'),
      apps: TEACHABLE.reduce((o, a) => {
        o[a] = (s.apps || {})[a] !== false;   // present and false means off
        return o;
      }, {}),
    },
    observed: { ...DEFAULT_OBSERVED, ...(p.observed || {}) },
  };
}

/* How much to trust behaviour over what they told us. Early on, almost none —
   a person's stated preference is the only evidence we have. */
const confidenceOf = observed => clamp((observed.stepsCompleted || 0) / 12, 0, 1);

/* The only part the runtime reads. */
function derive(profile) {
  const p = normalise(profile);
  const { stated, observed } = p;
  const c = confidenceOf(observed);

  // parallelism: stated, pulled down by tiles they close straight away and by
  // asking to slow down, pushed up by asking for more
  const pressure = (observed.slowDownSignals * 1.5 + observed.tilesClosedFast) - observed.speedUpSignals * 0.75;
  const adjusted = stated.parallelism - pressure * 0.5;
  const maxApps = clamp(Math.round(stated.parallelism * (1 - c) + adjusted * c), 1, 4);

  // check-ins: someone who keeps saying "next" does not want to be asked
  let checkinEvery = stated.checkins === 'every-step' ? 'step'
    : stated.checkins === 'rarely' ? 'never' : 'stage';
  if (c > 0.4) {
    if (observed.advanceRequests > 6 && observed.slowDownSignals === 0 && checkinEvery === 'step') checkinEvery = 'stage';
    if (observed.slowDownSignals >= 2) checkinEvery = 'step';
  }

  // depth: struggling on quizzes means go slower and deeper
  let depth = stated.depth;
  const accuracy = observed.quizzesTaken ? observed.quizAccuracySum / observed.quizzesTaken : null;
  if (accuracy !== null && observed.quizzesTaken >= 2) {
    if (accuracy < 0.5 && depth === 'concise') depth = 'balanced';
    else if (accuracy < 0.4) depth = 'thorough';
    else if (accuracy > 0.9 && depth === 'thorough') depth = 'balanced';
  }

  const preferredApps = Object.entries(observed.modalityUse || {})
    .sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 3);

  return {
    maxApps,
    checkinEvery,
    depth,
    pace: stated.pace,
    priorKnowledge: stated.priorKnowledge,
    modality: stated.modality,
    voice: stated.voice,
    chatter: stated.chatter,
    planPlace: stated.planPlace,
    mode: modeOf(stated),
    visuals: stated.visuals,
    /* The windows the agent is allowed to build in at all. A learner who never
       wants a podcast should not be offered one and then have to close it. */
    allowedApps: TEACHABLE.filter(a => stated.apps[a]),
    preferredApps,
    confidence: Number(c.toFixed(2)),
    stepsSeen: observed.stepsCompleted || 0,
    accuracy: accuracy === null ? null : Number(accuracy.toFixed(2)),
    onboarded: p.onboarded,
  };
}

/* Fold a behavioural signal into observed. Pure — callers persist the result. */
function applySignal(profile, kind, value = 1) {
  const p = normalise(profile);
  const o = p.observed;
  switch (kind) {
    case 'tile_closed_fast': o.tilesClosedFast += 1; break;
    case 'advance': o.advanceRequests += 1; break;
    case 'slow_down': o.slowDownSignals += 1; break;
    case 'speed_up': o.speedUpSignals += 1; break;
    case 'step_completed': o.stepsCompleted += 1; break;
    case 'quiz_score':
      o.quizzesTaken += 1;
      o.quizAccuracySum += clamp(Number(value) || 0, 0, 1);
      break;
    case 'app_used': {
      const app = String(value || '').slice(0, 20);
      if (app) o.modalityUse[app] = (o.modalityUse[app] || 0) + 1;
      break;
    }
    default: return p; // unknown signals are ignored, not fatal
  }
  o.lastUpdated = new Date().toISOString();
  return p;
}

/* The block handed to the model. Written as instruction, not as data dump. */
function brief(eff) {
  const lines = [];
  lines.push(`THIS LEARNER'S SETTINGS (derived from what they told us and how they actually work${eff.confidence >= 0.5 ? ', mostly the latter by now' : ''}):`);

  if (eff.maxApps === 1) {
    lines.push('- ONE WORKING WINDOW AT A TIME. They have told us plainly that two things on screen at once stops them absorbing either. Open the single app this step needs and nothing else. Opening a second will be refused.');
  } else {
    lines.push(`- Up to ${eff.maxApps} working windows at once, and only when they serve the SAME step. A quiz alongside a lesson is only acceptable if the step is "read then check yourself" — otherwise it is a distraction. Further opens beyond ${eff.maxApps} in one turn will be refused.`);
  }
  /* The plan is the spine, not a working window. Without saying so, a model
     told to keep one window open dutifully closes the plan to make room —
     which is the one window a paced learner most needs to keep. */
  lines.push('- The plan window does NOT count towards that limit and must stay open. Never close it to make room for something else; it is where they see which step they are on.');

  if (eff.checkinEvery === 'step') {
    lines.push('- CHECK IN AFTER EVERY STEP. Set up the step, tell them what to do, then STOP and wait. Do not start the next step, do not open anything for it, do not pre-empt it. They will say when they are ready (or press the button). Waiting is the correct behaviour, not idleness.');
  } else if (eff.checkinEvery === 'stage') {
    lines.push('- Check in at the end of each stage rather than each step. Within a stage you may carry on, but never queue up more than the current step\'s work.');
  } else {
    lines.push('- They like momentum: keep moving without asking permission. Still finish one step before starting the next. In particular, NEVER end a turn with only the plan on screen — build the thing the live step actually needs (a lesson, a quiz) in the same turn and hand it to them. Ending on "tell me when you are ready" is exactly what this learner does not want.');
  }

  lines.push(`- Depth: ${eff.depth}.` + (eff.depth === 'concise' ? ' Short sections, no preamble, trust them to ask.' : eff.depth === 'thorough' ? ' Go deeper than feels necessary; worked examples and second angles.' : ' Enough to be solid without padding.'));
  lines.push(`- Starting point, as a DEFAULT ONLY: ${eff.priorKnowledge === 'novice' ? 'assume no background' : eff.priorKnowledge === 'strong' ? 'skip the basics and go for the sharp end' : 'some background'}. Nobody is uniformly a beginner or an expert — they will be deep in some areas and blank in others. Judge this topic on what they say and what they get right, and override this default the moment you have evidence.`);

  /* Where your voice lives. This is a real choice, not a style note — for one
     learner the transcript is clutter over the workspace, for another the
     conversation IS the product. */
  if (eff.voice === 'windows') {
    lines.push('- SPEAK INSIDE THE WINDOWS. Use narrate for essentially everything you want to say: what to read first, what to notice, what to try, what people get wrong. The chat reply should be one short line or nothing at all. Never explain in chat something you could say beside the thing it is about.');
  } else if (eff.voice === 'chat') {
    lines.push('- SPEAK IN CHAT. They want a conversation, not captions. Put your explanation in the chat reply and use narrate sparingly — only for a pointer that genuinely has to sit beside something on screen.');
  } else {
    lines.push('- Speak in both places, with a division of labour: narrate what is specific to what is on screen, and use the chat reply for the connective tissue between steps.');
  }

  if (eff.chatter === 'minimal') {
    lines.push('- Keep the chat reply to one or two sentences. No preamble, no recap of what you just did, no "let me know if you have questions". They can see what you did.');
  } else if (eff.chatter === 'full') {
    lines.push('- A full chat reply is welcome — set up what you built, why it is in that order, and what to do with it.');
  }

  if (eff.visuals === 'plain') {
    lines.push('- Keep lessons mostly prose and tables. No diagrams or generated illustrations unless the content is genuinely structural and words would fail.');
  } else if (eff.visuals === 'rich') {
    lines.push('- Lean hard on visuals: a mermaid diagram or a chart in most sections, and a generated illustration where a picture carries something words cannot. They think in pictures.');
  } else {
    lines.push('- Use a diagram or table where the structure earns it — roughly one strong visual per lesson, not one per section.');
  }

  if (eff.planPlace === 'chat') {
    lines.push('- THE PLAN LIVES IN THE CONVERSATION, not in a window. Do NOT open the plan tile — it is switched off for them and opening it will be refused. The current step is already rendered in the chat surface, so never re-list the steps in your reply; say what to do now, in one or two lines, and let the spine on screen carry the structure. They can click a step or press Ready there, or simply tell you.');
  } else {
    lines.push('- The plan lives in its own window beside the work. Open it early and keep it there.');
  }

  const off = ['lesson', 'quiz', 'flashcards', 'podcast', 'deck'].filter(a => !eff.allowedApps.includes(a));
  if (off.length) {
    lines.push(`- TURNED OFF: ${off.join(', ')}. They have switched these windows off. Do not build them, do not offer them, do not mention them. Attempts will be refused.`);
  }
  if (eff.preferredApps.length) lines.push(`- They engage most with: ${eff.preferredApps.join(', ')}. Favour those.`);
  if (eff.accuracy !== null) lines.push(`- Rolling quiz accuracy: ${Math.round(eff.accuracy * 100)}%.`);
  return lines.join('\n');
}

module.exports = {
  normalise, derive, applySignal, brief, confidenceOf, modeOf, MODES, MODE_KEYS, TUNED,
  PACES, CHECKINS, DEPTHS, MODALITIES, DEFAULT_STATED,
};
