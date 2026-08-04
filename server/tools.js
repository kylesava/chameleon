/* The agent's hands: tool schemas + server-side executors.
   Every executor persists state, emits SSE events for the client's
   one-at-a-time action queue, and returns a short factual string the model
   reads as the tool_result. */

const APP_IDS = ['plan', 'sources', 'lesson', 'quiz', 'flashcards', 'podcast'];
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
    description: 'Write a lesson the learner reads in the lesson tile. Markdown body per section. Ground it in the notebook sources when they exist. Opens the lesson app automatically. Pass artifact_id to revise an existing lesson instead of creating a new one.',
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
              body: { type: 'string', description: 'Markdown. Keep sections tight — the learner can click any section to go deeper.' },
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

module.exports = { TOOLS, APP_IDS, SIZES, makeExecutors, applyLayoutActions };
