/* The agent's hands: tool schemas + server-side executors.
   Every executor persists state, emits SSE events for the client's
   one-at-a-time action queue, and returns a short factual string the model
   reads as the tool_result. */

const APP_IDS = ['plan', 'sources', 'lesson', 'quiz', 'flashcards', 'podcast', 'deck'];
const SIZES = ['s', 'm', 'l', 'xl'];

const TOOLS = [
  {
    name: 'update_plan',
    description: 'Create or replace the lesson plan — the visible checklist of goals the learner works through with you. Tasks in the same stage can be tackled in parallel; stages run in order. Keep it 3-8 tasks, concrete and checkable. Use set_task_status for progress instead of recreating the plan.',
    input_schema: {
      type: 'object',
      required: ['title', 'tasks'],
      properties: {
        title: { type: 'string', description: 'Short name for the learning goal, e.g. "Understand transformers"' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title'],
            properties: {
              title: { type: 'string', description: 'Checkable task, e.g. "Explain attention in your own words"' },
              detail: { type: 'string', description: 'One line of context (optional)' },
              stage: { type: 'integer', description: 'Ordering stage, 0-based. Same stage = parallel.' },
              status: { type: 'string', enum: ['todo', 'doing', 'done'] },
            },
          },
        },
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
    description: "Say a short line INSIDE an app window while you work on it — the workspace equivalent of talking while you write on the whiteboard. One or two sentences, shown in that tile and mirrored to the chat history. Use it to tell the learner what you are setting up or what to look at. The app must be open (or being opened this turn).",
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
- **Code** in a fenced block with its language tag; it gets syntax highlighting.

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
- "quote" — quote + optional attribution. A single arresting line, full bleed.

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
              layout: { type: 'string', enum: ['title', 'bullets', 'focus', 'split', 'quote'] },
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

  const openForArtifact = (app, size) => {
    const { layout, applied } = applyLayoutActions(ctx.layout.get(), [{ type: 'open', app, size: size || 'l', focus: true }]);
    ctx.layout.set(layout);
    applied.forEach(a => emit({ t: 'action', a }));
  };

  return {
    update_plan(input) {
      const plan = store.setPlan(sessionId, input.title, input.tasks);
      emit({ t: 'plan', plan });
      openForArtifact('plan', 'm');
      return `Plan saved: "${plan.title}" with ${plan.tasks.length} tasks — ` +
        plan.tasks.map(t => `#${t.id} [stage ${t.stage}] ${t.title} (${t.status})`).join('; ');
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
      const { layout, applied } = applyLayoutActions(ctx.layout.get(), input.actions);
      ctx.layout.set(layout);
      applied.forEach(a => emit({ t: 'action', a }));
      const now = layout.length ? layout.map(l => `${l.app}(${l.size}${l.focus ? ', focused' : ''})`).join(', ') : 'empty';
      return `Applied ${applied.length} action(s). Workspace now: ${now}`;
    },

    narrate(input) {
      store.addMessage(sessionId, 'assistant', input.text, 'narration', input.app);
      emit({ t: 'narrate', app: input.app, text: input.text });
      return 'Shown.';
    },

    create_lesson(input) {
      const art = store.saveArtifact(sessionId, 'lesson', input.title,
        { title: input.title, sections: input.sections }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'lesson', artifact: art });
      openForArtifact('lesson', input.size || 'l');
      return `Lesson artifact #${art.id} saved (${input.sections.length} sections) and opened.`;
    },

    create_flashcards(input) {
      const art = store.saveArtifact(sessionId, 'flashcards', input.title,
        { title: input.title, cards: input.cards }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'flashcards', artifact: art });
      openForArtifact('flashcards', 'm');
      return `Flashcard deck #${art.id} saved (${input.cards.length} cards) and opened.`;
    },

    create_quiz(input) {
      const qs = (input.questions || []).filter(q =>
        q.type === 'free' || (q.type === 'mc' && Array.isArray(q.choices) && q.choices.length >= 2 && Number.isInteger(q.answer_index)));
      if (!qs.length) throw new Error('quiz needs at least one valid question');
      const art = store.saveArtifact(sessionId, 'quiz', input.title,
        { title: input.title, questions: qs }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'quiz', artifact: art });
      openForArtifact('quiz', 'l');
      return `Quiz artifact #${art.id} saved (${qs.length} questions) and opened.`;
    },

    create_deck(input) {
      const slides = (input.slides || []).filter(s => s && s.layout);
      if (!slides.length) throw new Error('a deck needs at least one slide');
      const art = store.saveArtifact(sessionId, 'deck', input.title,
        { title: input.title, subtitle: input.subtitle || '', slides }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'deck', artifact: art });
      openForArtifact('deck', 'l');
      return `Deck #${art.id} saved (${slides.length} slides) and opened.`;
    },

    create_podcast(input) {
      const art = store.saveArtifact(sessionId, 'podcast', input.title,
        { title: input.title, description: input.description || '', lines: input.lines }, input.artifact_id || null);
      emit({ t: 'artifact', app: 'podcast', artifact: art });
      openForArtifact('podcast', 'm');
      return `Podcast script #${art.id} saved (${input.lines.length} lines) and opened. Audio synthesizes when the learner presses play.`;
    },

    add_note(input) {
      const src = store.addSource(sessionId, 'note', input.title, input.content);
      emit({ t: 'source', source: src });
      return `Note #${src.id} added to the notebook.`;
    },
  };
}

module.exports = { TOOLS, APP_IDS, SIZES, makeExecutors, applyLayoutActions, DRAFTABLE, TOOL_STATUS, draftScan };
