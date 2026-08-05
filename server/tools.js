/* The agent's hands: tool schemas + server-side executors.
   Every executor persists state, emits SSE events for the client's
   one-at-a-time action queue, and returns a short factual string the model
   reads as the tool_result. */

const images = require('./images.js');

const APP_IDS = ['plan', 'sources', 'lesson', 'quiz', 'flashcards', 'podcast', 'deck'];

/* Only advertise illustrations while they can actually be drawn — no key, or
   a provider that has stopped serving, means every lesson would come back
   peppered with placeholders that can never resolve. Evaluated per turn. */
const IMG_GUIDE = () => images.enabled()
  ? "\n- **Generated illustration** with `![short caption](gen:what to draw)` — an image model draws it in the workspace's own dark editorial style. Use it for what a diagram cannot carry: the feel of a concept, a physical scene, an analogy made visible. Describe the IMAGE, not the topic (\"a single lit doorway at the end of a long dark corridor, one figure walking toward it\"), and never ask for text inside it — labels come out garbled. At most one or two per lesson; a diagram beats a picture whenever the content is structural."
  : '';
const SIZES = ['s', 'm', 'l', 'xl'];

const buildTools = () => [
  {
    name: 'update_plan',
    description: `Create or replace the plan — the visible spine of the whole journey. 3-8 steps.

A step is not a topic, it is a piece of WORK the learner does. Every step needs all four fields or it is guesswork to them:
- title — what they will do, as an action ("Trace one carbon from glucose to CO₂"), not a subject heading ("The Krebs cycle")
- detail — one line on why it matters or what it hinges on
- done_when — the observable thing that ends it, in their words ("you can name all four stages without looking"). This is what tells them they're finished, so never leave it vague.
- apps — which window(s) this step happens in, e.g. ["lesson"] or ["quiz"]. Usually ONE.

Exactly one step is live at a time; set it with status "doing". Use set_task_status / complete_step for progress rather than rewriting the plan.`,
    input_schema: {
      type: 'object',
      required: ['title', 'tasks'],
      properties: {
        title: { type: 'string', description: 'Short name for the overall goal, e.g. "Understand transformers"' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'done_when'],
            properties: {
              title: { type: 'string', description: 'The work, phrased as an action the learner does' },
              detail: { type: 'string', description: 'One line: why this matters or what it hinges on' },
              done_when: { type: 'string', description: 'The observable finish line, in their words' },
              apps: { type: 'array', items: { type: 'string', enum: APP_IDS }, description: 'Which window(s) this step happens in — usually one' },
              stage: { type: 'integer', description: 'Ordering stage, 0-based. Same stage = related work.' },
              status: { type: 'string', enum: ['todo', 'doing', 'done'] },
            },
          },
        },
      },
    },
  },
  {
    name: 'remember_preference',
    description: `Record a lasting preference the learner has just expressed about HOW they want to work. Use this the moment they say something durable — "stop opening two things at once", "put the plan in the chat", "don't ask me every step", "I never want podcasts", "less detail", "talk to me in chat rather than in the windows". Do NOT use it for one-off requests about the current topic ("skip this bit", "go back") — only for how the product should behave from now on.

It takes effect immediately and permanently, is reflected in their settings, and you should acknowledge it in one short line. If they say something that maps to no setting here, do not force it — just do as they asked for now.`,
    input_schema: {
      type: 'object',
      required: ['setting', 'value'],
      properties: {
        setting: {
          type: 'string',
          enum: ['parallelism', 'checkins', 'planPlace', 'voice', 'chatter', 'depth', 'visuals', 'priorKnowledge', 'apps'],
          description: 'Which preference. parallelism=how many windows at once; checkins=whether to wait for them; planPlace=where the plan lives; voice=where you speak; chatter=how much you say in chat; depth=how much detail; visuals=diagram density; apps=turn a window on or off',
        },
        value: {
          type: 'string',
          description: 'parallelism: 1-4 · checkins: every-step|every-stage|rarely · planPlace: chat|window · voice: windows|both|chat · chatter: minimal|normal|full · depth: concise|balanced|thorough · visuals: plain|diagrams|rich · priorKnowledge: novice|some|strong · apps: "lesson:off" / "podcast:on"',
        },
        because: { type: 'string', description: 'One short line quoting or paraphrasing what they said, for the record' },
      },
    },
  },
  {
    name: 'complete_step',
    description: "Mark the live step finished and light the next one. Use this when the learner has actually shown the done_when condition — not merely been shown the material. If they need to confirm first (their settings will say), ask and wait rather than calling this.",
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Optional one-line record of what they demonstrated' },
      },
    },
  },
  {
    name: 'set_task_status',
    description: 'Mark plan tasks as doing/done/todo as the learner progresses. Task ids come from the plan state you were given (or the update_plan result).',
    input_schema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'status'],
            properties: {
              id: { type: 'integer' },
              status: { type: 'string', enum: ['todo', 'doing', 'done'] },
            },
          },
        },
      },
    },
  },
  {
    name: 'layout',
    description: 'Reshape the workspace: open, close, resize or focus app tiles on the 8x6 grid. Sizes: s (glanceable), m (working), l (deep), xl (hero). Apps re-open with their latest content. The UI plays actions one at a time — order them deliberately. Keep at most 4-5 tiles open; close stale ones.',
    input_schema: {
      type: 'object',
      required: ['actions'],
      properties: {
        actions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string', enum: ['open', 'close', 'resize', 'focus', 'close_all'] },
              app: { type: 'string', enum: APP_IDS },
              size: { type: 'string', enum: SIZES },
              focus: { type: 'boolean' },
            },
          },
        },
      },
    },
  },
  {
    name: 'narrate',
    description: "YOUR MAIN VOICE. Say a line INSIDE an app window — it appears in that tile, beside the thing it is about, and stays there until you say something else in that window. This is the workspace equivalent of talking while you write on the whiteboard, and it is where nearly all of your teaching commentary belongs. One or two sentences, pointed at what is on screen: what to read first, what to notice, what to try, what people usually get wrong here. Use it several times a turn — when you open something, when the content lands, when you hand them a task. The app must be open (or be opened this turn). Prefer this over saying it in chat; the chat reply should be almost nothing.",
    input_schema: {
      type: 'object',
      required: ['app', 'text'],
      properties: {
        app: { type: 'string', enum: APP_IDS },
        text: { type: 'string' },
      },
    },
  },
  {
    name: 'create_lesson',
    description: `Write a lesson the learner reads in the lesson tile. Opens the lesson app automatically. Pass artifact_id to revise an existing lesson instead of creating a new one.

Section bodies are RICH markdown and the renderer is genuinely capable — use it. Every section should earn its screen space with something more than paragraphs:

- **Mermaid diagrams** in a \`\`\`mermaid fence — the highest-value tool you have. Use flowchart/graph for processes and pipelines, sequenceDiagram for protocols and interactions over time, stateDiagram-v2 for state machines and lifecycles, erDiagram for data models, mindmap for concept breakdowns, timeline for history, journey for user experience, pie for proportions, quadrantChart for 2x2 trade-offs, xychart-beta for trends, gitGraph for branching. STICK TO THESE — other types render as broken text. Keep to ~12 nodes; label the edges (they carry the teaching). Put a plain-language sentence next to every diagram, so it still teaches if the picture fails.
- **Tables** for anything with parallel structure: comparisons, parameter meanings, before/after, layer-by-layer breakdowns. Far better than a bulleted list of pairs.
- **Callouts** — \`> [!KEY] title\` for the one idea that must stick, \`[!WARNING]\` for the mistake everyone makes, \`[!TIP]\` for a shortcut, \`[!EXAMPLE]\` for a worked case, \`[!QUESTION]\` to make them predict before you tell them.
- **Maths** with LaTeX between $...$ inline or $$...$$ on its own line. Use real notation, not ASCII.
- **Charts** in a \`\`\`chart fence containing a Vega-Lite spec ({"data":{"values":[...]},"mark":"bar","encoding":{...}}) when actual numbers tell the story.
- **Code** in a fenced block with its language tag; it gets syntax highlighting.${IMG_GUIDE()}

Aim for a diagram or table in most sections, and at least one callout per lesson. Do not decorate for its own sake — every visual must carry meaning the prose would labour over.`,
    input_schema: {
      type: 'object',
      required: ['title', 'sections'],
      properties: {
        title: { type: 'string' },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['heading', 'body'],
            properties: {
              heading: { type: 'string' },
              body: { type: 'string', description: 'Rich markdown: prose plus mermaid fences, tables, callouts, $maths$, chart fences, code. Keep the prose tight — the visuals do the heavy lifting. The learner can click any section to go deeper.' },
            },
          },
        },
        artifact_id: { type: 'integer', description: 'Existing lesson to replace/revise' },
        size: { type: 'string', enum: SIZES, description: 'Tile size to open at (default l)' },
      },
    },
  },
  {
    name: 'create_flashcards',
    description: 'Create a flashcard deck for spaced practice. 4-10 cards, one fact each. Opens the flashcards app automatically. Pass artifact_id to replace an existing deck.',
    input_schema: {
      type: 'object',
      required: ['title', 'cards'],
      properties: {
        title: { type: 'string' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            required: ['q', 'a'],
            properties: { q: { type: 'string' }, a: { type: 'string' } },
          },
        },
        artifact_id: { type: 'integer' },
      },
    },
  },
  {
    name: 'create_quiz',
    description: "Create an interactive quiz. 'mc' questions are checked instantly in the UI (give 3-5 choices + answer_index + a one-line explain). 'free' questions collect a typed answer that comes back to you for grading. Opens the quiz app automatically.",
    input_schema: {
      type: 'object',
      required: ['title', 'questions'],
      properties: {
        title: { type: 'string' },
        questions: {
          type: 'array',
          items: {
            type: 'object',
            required: ['type', 'prompt'],
            properties: {
              type: { type: 'string', enum: ['mc', 'free'] },
              prompt: { type: 'string' },
              choices: { type: 'array', items: { type: 'string' } },
              answer_index: { type: 'integer', description: '0-based index of the correct choice (mc only)' },
              explain: { type: 'string', description: 'Shown after the learner answers' },
            },
          },
        },
        artifact_id: { type: 'integer' },
      },
    },
  },
  {
    name: 'create_podcast',
    description: 'Write a short two-host audio overview of the topic (NotebookLM style). Real audio is synthesized per line when the learner presses play. 10-30 lines, conversational, hosts A and B trading off. Opens the podcast app automatically.',
    input_schema: {
      type: 'object',
      required: ['title', 'lines'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            required: ['host', 'text'],
            properties: {
              host: { type: 'string', enum: ['A', 'B'] },
              text: { type: 'string' },
            },
          },
        },
        artifact_id: { type: 'integer' },
      },
    },
  },
  {
    name: 'create_deck',
    description: `Build a slide deck the learner can present or step through — for explaining something to someone else, revising a topic visually, or when they ask for slides. Opens the deck app automatically. Pass artifact_id to revise an existing deck.

Choose a layout per slide and fill only that layout's fields:
- "title" — the opener. title + subtitle.
- "bullets" — title + bullets (3-5, each under ~10 words; they are talking points, not paragraphs).
- "focus" — title + body, where body is one big idea: a mermaid diagram, a chart, a table, or a short statement. This is your workhorse for anything visual.
- "split" — title + left + right markdown. For before/after, problem/solution, theory/practice.
- "quote" — quote + optional attribution. A single arresting line, full bleed.${images.enabled() ? '\n- "image" — title + body, where body is a single `![caption](gen:what to draw)` illustration, shown full bleed with the title over it. Use it to open a section, to sit on an analogy, or to rest the eye between dense slides. One or two per deck.' : ''}

Slide bodies, left/right and bullets all take the same rich markdown the lesson uses: mermaid fences, chart fences, tables, $maths$, code, callouts. A deck of nothing but bullet lists is a bad deck — carry the argument with diagrams and comparisons, and let each slide make exactly one point.

Always write "notes" for each slide: what the presenter should actually say. That is where the detail lives; the slide itself stays sparse.`,
    input_schema: {
      type: 'object',
      required: ['title', 'slides'],
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            required: ['layout'],
            properties: {
              layout: { type: 'string', enum: images.enabled() ? ['title', 'bullets', 'focus', 'split', 'quote', 'image'] : ['title', 'bullets', 'focus', 'split', 'quote'] },
              title: { type: 'string' },
              subtitle: { type: 'string' },
              bullets: { type: 'array', items: { type: 'string' } },
              body: { type: 'string', description: 'Rich markdown — a mermaid fence, chart fence, table, or short statement.' },
              left: { type: 'string' },
              right: { type: 'string' },
              quote: { type: 'string' },
              attribution: { type: 'string' },
              notes: { type: 'string', description: 'What to say out loud on this slide.' },
            },
          },
        },
        artifact_id: { type: 'integer' },
      },
    },
  },
  {
    name: 'add_note',
    description: "Append a note to the learner's notebook (the sources app) — key takeaways, definitions, things to revisit. Notes become part of the grounding context.",
    input_schema: {
      type: 'object',
      required: ['title', 'content'],
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
      },
    },
  },
];

/* ---- live drafting (commandment 7) ----
   Which tool fills which app, the array we stream out of its still-arriving
   input, and the line shown the instant the tool starts. */
const DRAFTABLE = {
  create_quiz:       { app: 'quiz',       field: 'questions', size: 'l', status: 'Writing your quiz…' },
  create_lesson:     { app: 'lesson',     field: 'sections',  size: 'l', status: 'Writing the lesson…' },
  create_flashcards: { app: 'flashcards', field: 'cards',     size: 'm', status: 'Building the deck…' },
  create_podcast:    { app: 'podcast',    field: 'lines',     size: 'm', status: 'Recording the episode…' },
  create_deck:       { app: 'deck',       field: 'slides',    size: 'l', status: 'Building your deck…' },
  update_plan:       { app: 'plan',       field: 'tasks',     size: 'm', status: 'Mapping out your goals…' },
};
/* Tools with no streamable body still announce themselves. */
const TOOL_STATUS = {
  set_task_status: 'Updating your goals…',
  narrate: null,
  layout: null,
  add_note: 'Adding a note…',
};

/* Repair a truncated JSON object so the part that HAS arrived can be read:
   close an open string, drop a dangling key or comma, close open brackets.
   Returns null if nothing coherent can be salvaged yet. */
function repairPartial(src) {
  let inStr = false, esc = false;
  const stack = [];
  const cuts = []; // safe places to trim back to: commas between this object's own fields
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',' && stack.length === 1) cuts.push(i);
  }
  let body = src;
  if (esc) body = body.slice(0, -1);
  let close = stack.slice().reverse().join('');
  for (let attempt = 0; ; attempt++) {
    const candidate = body + (inStr && attempt === 0 ? '"' : '') + close;
    try {
      const v = JSON.parse(candidate);
      if (v && typeof v === 'object') return v;
    } catch {}
    // trim back past the field that is still arriving and try again
    const cut = cuts.pop();
    if (cut === undefined) return null;
    body = src.slice(0, cut);
    inStr = false;
    close = '}';
  }
}

/* Read the tool input WHILE it is still arriving.
   Returns { head, items }: `head` is the top-level scalar fields that have
   landed (a title, say), `items` is every element of `field`'s array — the
   last one flagged `_partial` when it is still being written, so the UI can
   show a heading and its body filling in rather than waiting for the object
   to close. Text arrives in real time; nothing is ever shown as final early. */
function draftScan(partialJson, field) {
  const out = { head: {}, items: [] };
  const key = `"${field}"`;
  const k = partialJson.indexOf(key);

  // top-level scalars that precede the array (e.g. "title")
  const headSrc = k >= 0 ? partialJson.slice(0, k).replace(/,\s*$/, '') : partialJson;
  const head = repairPartial(headSrc.startsWith('{') ? headSrc : '{' + headSrc);
  if (head) for (const [kk, v] of Object.entries(head)) if (v !== null && typeof v !== 'object') out.head[kk] = v;

  if (k < 0) return out;
  const start = partialJson.indexOf('[', k);
  if (start < 0) return out;

  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = start + 1; i < partialJson.length; i++) {
    const c = partialJson[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try { out.items.push(JSON.parse(partialJson.slice(objStart, i + 1))); } catch {}
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) { objStart = -1; break; }
  }
  // The element still being written. Only surfaced once it carries something
  // readable — an object whose first key hasn't landed yet would appear and
  // then vanish, making the list flicker.
  if (objStart >= 0) {
    const partial = repairPartial(partialJson.slice(objStart));
    if (partial && Object.keys(partial).length) out.items.push({ ...partial, _partial: true });
  }
  return out;
}

/* ---- layout snapshot helpers (server-side mirror of the client grid) ---- */
function applyLayoutActions(layout, actions) {
  let out = [...layout];
  const applied = [];
  for (const a of actions || []) {
    if (a.type === 'close_all') { out = []; applied.push({ type: 'close_all' }); continue; }
    if (!APP_IDS.includes(a.app)) continue;
    const i = out.findIndex(x => x.app === a.app);
    switch (a.type) {
      case 'open': {
        const size = SIZES.includes(a.size) ? a.size : 'm';
        // A no-op re-open (already open, same size, no focus change) would burn
        // a beat in the client's one-at-a-time queue for nothing.
        if (i >= 0 && out[i].size === size && (!a.focus || out[i].focus)) break;
        if (i >= 0) out[i] = { ...out[i], size };
        else out.push({ app: a.app, size, focus: false });
        if (a.focus) out = out.map(x => ({ ...x, focus: x.app === a.app }));
        applied.push({ type: 'open', app: a.app, size, focus: !!a.focus });
        break;
      }
      case 'close':
        if (i >= 0) { out.splice(i, 1); applied.push({ type: 'close', app: a.app }); }
        break;
      case 'resize':
        if (i >= 0 && SIZES.includes(a.size)) { out[i] = { ...out[i], size: a.size }; applied.push({ type: 'resize', app: a.app, size: a.size }); }
        break;
      case 'focus':
        if (i >= 0) { out = out.map(x => ({ ...x, focus: x.app === a.app })); applied.push({ type: 'focus', app: a.app }); }
        break;
    }
  }
  return { layout: out, applied };
}

/* ---- executors ----
   ctx: { store, sessionId, emit(event), layout: {get, set} } */
function makeExecutors(ctx) {
  const { store, sessionId, emit } = ctx;
  /* The pacing guarantee. A prompt asking for one window at a time is a wish;
     this is the enforcement. Windows newly opened in THIS turn are counted —
     re-focusing or resizing something already open is free. */
  const budget = Math.max(1, Number(ctx.maxApps) || 4);
  const openedThisTurn = new Set();

  /* Windows the learner has switched off entirely. Enforced rather than merely
     asked for: a setting the agent can talk itself out of is not a setting.
     plan and sources are structural and never switchable. */
  const allowed = Array.isArray(ctx.allowedApps) ? ctx.allowedApps : null;
  const planInChat = ctx.planPlace === 'chat';
  const permitted = app => {
    if (app === 'plan') return !planInChat;      // the spine is in the conversation
    if (app === 'sources') return true;
    return !allowed || allowed.includes(app);
  };
  const notAllowed = app => new Error(app === 'plan'
    ? 'Refused: this learner keeps the plan in the conversation, not in a window. It is already on screen there — do not open a plan tile and do not re-list the steps in your reply.'
    : `Refused: this learner has turned the ${app} window off. Do not build one, do not offer it, and do not mention it — use one of: ${(allowed || []).concat('sources').join(', ')}.`);

  const isOpen = app => ctx.layout.get().some(l => l.app === app);
  const withinBudget = (app) => {
    if (app === 'plan' || isOpen(app) || openedThisTurn.has(app)) return true;
    return openedThisTurn.size < budget;
  };
  /* Only a window that was not already there costs anything. Counting a no-op
     re-open used to spend a one-window learner's entire budget on the plan tile
     the model had just been told to show, after which every teaching window for
     that turn was refused. */
  const chargeFor = (app) => { if (app !== 'plan' && !isOpen(app)) openedThisTurn.add(app); };
  const budgetError = () => new Error(
    budget === 1
      ? 'Refused: this learner works one window at a time and one is already open for this step. Finish with it, or close it first — do not open a second.'
      : `Refused: budget of ${budget} window(s) for this turn is used up. Close something, or leave the rest for the next step.`);

  const openForArtifact = (app, size) => {
    if (!permitted(app)) throw notAllowed(app);
    if (!withinBudget(app)) throw budgetError();
    chargeFor(app);
    const { layout, applied } = applyLayoutActions(ctx.layout.get(), [{ type: 'open', app, size: size || 'l', focus: true }]);
    ctx.layout.set(layout);
    applied.forEach(a => emit({ t: 'action', a }));
  };

  return {
    /* The learner coaching the product in their own words. Same store the
       settings sheet writes to, so what they say in chat and what they set by
       hand are one thing, not two. */
    remember_preference(input) {
      if (!ctx.setPreference) return 'Preferences cannot be saved in this session.';
      const setting = String(input.setting || '');
      const raw = String(input.value || '').trim();
      const ALLOWED = {
        parallelism: v => (/^[1-4]$/.test(v) ? Number(v) : null),
        checkins: v => (['every-step', 'every-stage', 'rarely'].includes(v) ? v : null),
        planPlace: v => (['chat', 'window'].includes(v) ? v : null),
        voice: v => (['windows', 'both', 'chat'].includes(v) ? v : null),
        chatter: v => (['minimal', 'normal', 'full'].includes(v) ? v : null),
        depth: v => (['concise', 'balanced', 'thorough'].includes(v) ? v : null),
        visuals: v => (['plain', 'diagrams', 'rich'].includes(v) ? v : null),
        priorKnowledge: v => (['novice', 'some', 'strong'].includes(v) ? v : null),
      };
      let patch = null;
      if (setting === 'apps') {
        const m = raw.match(/^(lesson|quiz|flashcards|podcast|deck)\s*[:=]\s*(on|off|true|false)$/i);
        if (!m) return 'Not saved: apps takes "lesson:off" or "podcast:on".';
        patch = { apps: { [m[1].toLowerCase()]: /^(on|true)$/i.test(m[2]) } };
      } else {
        const fn = ALLOWED[setting];
        if (!fn) return `Not saved: "${setting}" is not a setting.`;
        const v = fn(raw);
        if (v === null) return `Not saved: "${raw}" is not a valid value for ${setting}.`;
        patch = { [setting]: v };
      }
      const saved = ctx.setPreference(patch, input.because || '');
      emit({ t: 'preference', patch, because: String(input.because || '').slice(0, 200) });
      /* It applies from the NEXT turn — this turn's executors were built with
         the old budget, and silently changing it mid-turn would be worse than
         saying so plainly. */
      return `Saved. ${JSON.stringify(patch)} is now their setting and takes effect from the next turn. Acknowledge it in one short line — do not restate the whole setting list.` +
        (saved && saved.note ? ` (${saved.note})` : '');
    },

    update_plan(input) {
      const tasks = (input.tasks || []).map(t => ({ ...t }));
      /* A step with no finish line is the guesswork this rebuild exists to
         remove, so it is refused rather than warned about — a warning arrives
         after the learner has already been shown the vague plan. */
      const vague = tasks.filter(t => !String(t.done_when || '').trim());
      if (vague.length) {
        throw new Error(
          `Refused: ${vague.length} step(s) have no done_when — ${vague.map(t => `"${t.title}"`).join(', ')}. ` +
          'Every step needs the observable thing that ends it, written in the learner\'s words ' +
          '("you can name all four stages without looking"). Call update_plan again with all of them filled in.');
      }
      // the spine is meaningless without a live step, so guarantee one
      if (tasks.length && !tasks.some(t => t.status === 'doing')) {
        const first = tasks.find(t => t.status !== 'done');
        if (first) first.status = 'doing';
      }
      const plan = store.setPlan(sessionId, input.title, tasks);
      emit({ t: 'plan', plan });
      /* When the spine lives in the conversation there is no tile to open —
         the chat surface renders it. Opening one anyway would be exactly the
         extra window this learner asked not to have. */
      if (ctx.planPlace !== 'chat') {
        // the plan window never counts against the budget: it is the spine, not
        // a thing to work in
        const { layout, applied } = applyLayoutActions(ctx.layout.get(), [{ type: 'open', app: 'plan', size: 'm', focus: true }]);
        ctx.layout.set(layout);
        applied.forEach(a => emit({ t: 'action', a }));
      }
      return `Plan saved: "${plan.title}" with ${plan.tasks.length} steps — ` +
        plan.tasks.map(t => `#${t.id} [stage ${t.stage}] ${t.title} (${t.status})`).join('; ');
    },

    complete_step(input) {
      const r = store.advancePlan(sessionId);
      if (!r) return 'No plan to advance.';
      emit({ t: 'plan', plan: r.plan });
      if (ctx.onStepComplete) ctx.onStepComplete(r.completed);
      return r.next
        ? `Completed "${r.completed ? r.completed.title : '—'}"${input.note ? ` (${input.note})` : ''}. Now live: #${r.next.id} "${r.next.title}" — done when: ${r.next.done_when || 'not stated'}.`
        : `Completed "${r.completed ? r.completed.title : '—'}". That was the last step — the plan is finished.`;
    },

    set_task_status(input) {
      const changed = [];
      for (const t of input.tasks || []) {
        const row = store.setTaskStatus(t.id, t.status);
        if (row) changed.push(`#${row.id} → ${row.status}`);
      }
      const plan = store.getPlan(sessionId);
      if (plan) emit({ t: 'plan', plan });
      return changed.length ? `Updated: ${changed.join(', ')}` : 'No matching tasks.';
    },

    layout(input) {
      // opens are filtered against the budget; closes/resizes/focus always pass
      const requested = input.actions || [];
      const actions = [];
      const blocked = [];
      let refused = 0;
      let spineClose = false;
      const hasPlan = !planInChat && !!store.getPlan(sessionId);  // nothing to protect if the spine is in chat
      for (const a of requested) {
        if (a.type === 'open') {
          if (!permitted(a.app)) { blocked.push(a.app); continue; }
          if (!withinBudget(a.app)) { refused++; continue; }
          chargeFor(a.app);
        }
        /* Told to keep one window open, a model dutifully closes the plan to
           make room — losing the learner the one window that tells them where
           they are. The learner may close it; the agent may not. */
        if (a.type === 'close' && a.app === 'plan' && hasPlan) { spineClose = true; continue; }
        if (a.type === 'close_all' && hasPlan) {
          // rewritten as explicit closes so the plan survives the sweep
          for (const l of ctx.layout.get()) if (l.app !== 'plan') actions.push({ type: 'close', app: l.app });
          spineClose = true;
          continue;
        }
        actions.push(a);
      }
      const { layout, applied } = applyLayoutActions(ctx.layout.get(), actions);
      ctx.layout.set(layout);
      applied.forEach(a => emit({ t: 'action', a }));
      const now = layout.length ? layout.map(l => `${l.app}(${l.size}${l.focus ? ', focused' : ''})`).join(', ') : 'empty';
      return `Applied ${applied.length} action(s). Workspace now: ${now}` +
        (blocked.length ? ` — ${notAllowed(blocked[0]).message}` : '') +
        (refused ? ` — ${refused} open(s) refused: ${budgetError().message}` : '') +
        (spineClose ? ' — the plan window was kept open: it is the spine, does not count against the window budget, and is never yours to close. Shrink it to "s" if you need the room.' : '');
    },

    narrate(input) {
      store.addMessage(sessionId, 'assistant', input.text, 'narration', input.app);
      emit({ t: 'narrate', app: input.app, text: input.text });
      return 'Shown.';
    },

    create_lesson(input) {
      /* Validate and check the budget BEFORE writing. Saving first meant a
         refused open left the artifact behind, so each retry stacked up another
         copy of the same lesson — and a non-array `sections` was persisted and
         then crashed the renderer on every paint, permanently. */
      const sections = (Array.isArray(input.sections) ? input.sections : [])
        .filter(s => s && typeof s === 'object' && (s.heading || s.body));
      if (!sections.length) throw new Error('Refused: a lesson needs a sections array, each with a heading and a body.');
      if (!permitted('lesson')) throw notAllowed('lesson');
      if (!withinBudget('lesson')) throw budgetError();
      const art = store.saveArtifact(sessionId, 'lesson', input.title,
        { title: input.title, sections }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'lesson', artifact: art });
      openForArtifact('lesson', input.size || 'l');
      return `Lesson artifact #${art.id} saved (${sections.length} sections) and opened.`;
    },

    create_flashcards(input) {
      const cards = (Array.isArray(input.cards) ? input.cards : []).filter(c => c && (c.front || c.back));
      if (!cards.length) throw new Error('Refused: a deck needs a cards array, each with a front and a back.');
      if (!permitted('flashcards')) throw notAllowed('flashcards');
      if (!withinBudget('flashcards')) throw budgetError();
      const art = store.saveArtifact(sessionId, 'flashcards', input.title,
        { title: input.title, cards }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'flashcards', artifact: art });
      openForArtifact('flashcards', 'm');
      return `Flashcard deck #${art.id} saved (${cards.length} cards) and opened.`;
    },

    create_quiz(input) {
      const qs = (input.questions || []).filter(q =>
        q.type === 'free' || (q.type === 'mc' && Array.isArray(q.choices) && q.choices.length >= 2 && Number.isInteger(q.answer_index)));
      if (!qs.length) throw new Error('quiz needs at least one valid question');
      if (!permitted('quiz')) throw notAllowed('quiz');
      if (!withinBudget('quiz')) throw budgetError();
      const art = store.saveArtifact(sessionId, 'quiz', input.title,
        { title: input.title, questions: qs }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'quiz', artifact: art });
      openForArtifact('quiz', 'l');
      return `Quiz artifact #${art.id} saved (${qs.length} questions) and opened.`;
    },

    create_deck(input) {
      const slides = (input.slides || []).filter(s => s && s.layout);
      if (!slides.length) throw new Error('a deck needs at least one slide');
      if (!permitted('deck')) throw notAllowed('deck');
      if (!withinBudget('deck')) throw budgetError();
      const art = store.saveArtifact(sessionId, 'deck', input.title,
        { title: input.title, subtitle: input.subtitle || '', slides }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'deck', artifact: art });
      openForArtifact('deck', 'l');
      return `Deck #${art.id} saved (${slides.length} slides) and opened.`;
    },

    create_podcast(input) {
      const lines = (Array.isArray(input.lines) ? input.lines : []).filter(l => l && l.text);
      if (!lines.length) throw new Error('Refused: a podcast needs a lines array, each with a host and text.');
      if (!permitted('podcast')) throw notAllowed('podcast');
      if (!withinBudget('podcast')) throw budgetError();
      const art = store.saveArtifact(sessionId, 'podcast', input.title,
        { title: input.title, description: input.description || '', lines }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'podcast', artifact: art });
      openForArtifact('podcast', 'm');
      return `Podcast script #${art.id} saved (${lines.length} lines) and opened. Audio synthesizes when the learner presses play.`;
    },

    add_note(input) {
      const src = store.addSource(sessionId, 'note', input.title, input.content);
      emit({ t: 'source', source: src });
      return `Note #${src.id} added to the notebook.`;
    },
  };
}

module.exports = { buildTools, get TOOLS() { return buildTools(); }, APP_IDS, SIZES, makeExecutors, applyLayoutActions, DRAFTABLE, TOOL_STATUS, draftScan };
