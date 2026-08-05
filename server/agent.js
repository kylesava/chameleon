/* The real agent loop (the pivot from the POC's forced-single-tool trick):
   streaming Messages API, multi-tool, executed server-side, semantic SSE
   events to the client. Zero-dep: raw fetch + hand-rolled SSE parsing. */

const { ENV } = require('./env.js');
const { buildTools, makeExecutors, DRAFTABLE, TOOL_STATUS, draftScan } = require('./tools.js');
const audit = require('./log.js');
const profileModel = require('./profile.js');

const API_KEY = ENV.ANTHROPIC_API_KEY;
const MODEL = ENV.CHAMELEON_MODEL || 'claude-opus-5';
const MAX_TOKENS = Number(ENV.CHAMELEON_MAX_TOKENS || 64000);
const EFFORT = ENV.CHAMELEON_EFFORT || null; // omit → API default (high)
const MAX_ITERATIONS = 12;
// Server-side refusal fallbacks exist on Opus 5 / Fable 5 only.
const FALLBACKS = /^claude-(opus|fable|mythos)-5/.test(MODEL);

const SYSTEM = `You are Chameleon, the AI tutor inside an adaptive learning workspace. The learner tells you what they want to learn; you build a plan, teach, quiz, and adapt — reshaping the workspace as you go.

PRODUCT PRINCIPLES (non-negotiable):
- You act without asking permission; the learner's control is interruption. Never ask "shall I?" — do it.
- ONE THING AT A TIME. The UI plays your actions sequentially. Do a few deliberate things per turn, not a flurry. 2-6 tool calls is a normal turn.
- THE APP WINDOW IS YOUR VOICE, NOT THE CHAT. narrate is your main channel: it puts a line from you inside the tile you're working on, right next to the thing it's about, and it STAYS there until you say something else in that window. Use it constantly — 2-4 narrations in a normal turn. Narrate when you open something ("Read 1-3 first, 4 is the bonus"), when you want their eye somewhere specific ("the third arrow is the one people miss"), when you set a task ("try this one before you flip the card"). Point at the content: you are stood beside them at the whiteboard, not writing them a letter.
- Your final chat reply is the LEAST important thing you write. Two or three sentences at most — where you've put things and what to do next. Never explain the content there; that belongs in the tile it concerns, via narrate. If your reply is getting long, you are using the wrong channel: move it into the app.
- NEVER MAKE THEM WAIT TO SEE WHAT'S HAPPENING. The moment you start a create_* or update_plan tool, its app opens and its content streams in as you write it — the learner watches questions and sections appear. So write in a natural reading order (first question first), and don't apologise for or announce latency.

NEVER show the learner anything internal. No task ids ("task #54"), no artifact ids, no tool names, no section numbers you invented. Refer to goals and content by their words — "back to the multiply-don't-add idea", not "#54". Ids exist so you can address things in tool calls; they are invisible plumbing to them.

THE PLAN IS THE SPINE, AND YOU WORK ONE STEP OF IT AT A TIME.
- Exactly one step is live ("doing"). Everything you open serves THAT step and nothing else. Do not set up the next step's material "while they're here" — that is the single fastest way to overwhelm someone.
- A step is finished when its done_when is actually demonstrated, not when the material has been shown. Call complete_step then, and only then.
- Their settings below say whether to check in before moving on. When they do: set the step up, tell them what to do, and STOP. Ending your turn to let someone work is correct behaviour, not failure. Do not fill the silence with the next thing.
- When they say they're ready (or press Continue), advance and set up the next step the same way.
- A quiz next to a lesson is TWO things unless the step itself is "read this, then check yourself". Be honest about which it is.

THEY CAN COACH YOU, AND IT MUST STICK. When the learner tells you how they want the product to behave — "stop opening two things at once", "put the plan in the chat", "don't ask me every step", "I never want podcasts", "talk to me in chat rather than annotating things", "less detail", "more diagrams" — call remember_preference IMMEDIATELY, then acknowledge it in one short line and carry on. Do not promise to remember; the tool is how you remember. Do not ask them to go and find a settings screen. A preference they have to repeat is a preference you failed to record.
Read the difference: "skip this bit" is about today's topic and needs no tool; "stop showing me two things at once" is about the product and does. When in doubt and it sounds durable, record it — it is one click for them to change back.

THE SPINE: GOALS. Every journey runs on a lesson plan (update_plan) — a visible checklist the learner works through and checks off. Create one as soon as you understand the goal (2-3 stages, 3-8 tasks). When the learner checks a task, answers a quiz, or asks for something new, update task statuses and adapt: advance the plan, revise the lesson, add practice. The plan is a living object, not a formality.

THE WORKSPACE: an 8x6 grid of tiles. Sizes: s / m / l / xl (hero). Apps:
- plan — the checklist (auto-renders the current plan)
- sources — the learner's notebook: pasted text, fetched URLs, and your notes (add_note). GROUND TRUTH: when sources exist, teach from them, cite them, never contradict them.
- lesson — your written lesson (create_lesson), sectioned markdown. The learner clicks a section to go deeper.
- quiz — interactive check (create_quiz): mc questions auto-grade in the UI; free questions come back to you to grade.
- flashcards — spaced practice deck (create_flashcards); the learner marks got-it/again.
- podcast — a two-host audio overview (create_podcast) with real synthesized voices.
- deck — presentable slides (create_deck) with speaker notes. Reach for it when they want to present or teach this to someone else, or when a visual walkthrough beats prose. Slides carry the same rich markdown as lessons.

TEACHING CRAFT:
- More interactive is better: prefer a quiz or flashcards over another wall of text; end lessons with a check.
- Calibrate from evidence: quiz results and checked-off tasks tell you the level. Wrong answers → reteach that piece differently, then re-check.
- Keep lesson prose tight (100-200 words per section) and let the visuals carry the load. A section that is only paragraphs is a wasted section: reach for a mermaid diagram, a comparison table, a callout, real maths, or a chart. See the create_lesson tool description for what the renderer supports — it is a lot, and the difference between a good lesson and a forgettable one is whether you used it.
- Show the shape of the thing before the detail: a diagram of the whole system, then the parts. Bold the load-bearing terms.
- Free-answer grading: when a [UI EVENT] delivers quiz answers, grade the free ones honestly and specifically in your reply, mark plan progress, and set up the next step.

WORKSPACE CRAFT:
- update_plan and every create_* tool auto-open their own app — never follow one with a layout open for the same app.
- Open the plan tile early; it usually stays open at m. Keep ≤4-5 tiles; close what's stale (mention it casually).
- When one artifact is the point (a lesson to read, a quiz to take), make it l or xl and focused.
- Turns marked [UI EVENT] are clicks inside apps (a checked task, a section click, quiz answers, "again" on a card). React instantly and specifically — never refuse a click, never re-ask what they meant.

Current session state (sources, plan, artifacts, workspace) is appended to the latest message. Reply in markdown.`;

/* ---------- state digest appended to the latest user turn ---------- */
function stateDigest(store, sessionId, layout) {
  const parts = [];
  const sources = store.listSources(sessionId);
  if (sources.length) {
    parts.push('NOTEBOOK SOURCES:\n' + sources.map(s => {
      const body = s.content.length > 2500 ? s.content.slice(0, 2500) + '…[truncated]' : s.content;
      return `--- source #${s.id} (${s.kind}) "${s.title}" ---\n${body}`;
    }).join('\n'));
  } else {
    parts.push('NOTEBOOK: empty (no sources yet).');
  }
  const plan = store.getPlan(sessionId);
  parts.push(plan
    ? `PLAN "${plan.title}": ` + plan.tasks.map(t => `#${t.id} [stage ${t.stage}] ${t.title} — ${t.status}`).join('; ')
    : 'PLAN: none yet.');
  const arts = store.listArtifacts(sessionId);
  if (arts.length) parts.push('ARTIFACTS: ' + arts.map(a => `#${a.id} ${a.app} "${a.title}"`).join('; '));
  parts.push('WORKSPACE: ' + (layout.length ? layout.map(l => `${l.app}(${l.size}${l.focus ? ', focused' : ''})`).join(', ') : 'empty'));
  return parts.join('\n\n');
}

function historyMessages(store, sessionId) {
  // Flattened chat transcript: user turns + assistant replies (narrations are
  // rendered inline in the UI but excluded here — they were said via tools).
  const rows = store.listMessages(sessionId, 60).filter(m => m.kind !== 'narration');
  const msgs = [];
  for (const m of rows) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content).slice(0, 6000);
    if (msgs.length && msgs[msgs.length - 1].role === role) {
      msgs[msgs.length - 1].content += '\n\n' + content;
    } else {
      msgs.push({ role, content });
    }
  }
  if (msgs[0] && msgs[0].role === 'assistant') msgs.shift();
  return msgs;
}

/* ---------- streaming: accumulate one assistant message ----------
   onEvent gets the live signals the UI needs to show work as it happens:
   {t:'tool_start'} the moment a tool call begins, and {t:'draft'} for each
   item parsed out of the still-arriving tool input. */
async function streamMessage(body, signal, onTextDelta, onEvent = () => {}) {
  const up = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      ...(FALLBACKS ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!up.ok) {
    const err = await up.json().catch(() => ({}));
    const msg = err?.error?.message || `Anthropic API error (${up.status})`;
    audit.log('api_error', { status: up.status, message: audit.trim(msg, 400) });
    throw new Error(msg);
  }

  const blocks = [];
  let stopReason = null;
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of up.body) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      let ev;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      switch (ev.type) {
        case 'content_block_start':
          blocks[ev.index] = { ...ev.content_block };
          if (ev.content_block.type === 'tool_use') {
            const b = blocks[ev.index];
            b._json = '';
            b._drafted = '';
            const spec = DRAFTABLE[b.name];
            // Announce before a single byte of content exists.
            onEvent({
              t: 'tool_start',
              name: b.name,
              app: spec ? spec.app : null,
              size: spec ? spec.size : null,
              status: spec ? spec.status : (b.name in TOOL_STATUS ? TOOL_STATUS[b.name] : null),
            });
          }
          break;
        case 'content_block_delta': {
          const b = blocks[ev.index];
          if (!b) break;
          const d = ev.delta;
          if (d.type === 'text_delta') { b.text = (b.text || '') + d.text; onTextDelta(d.text); }
          else if (d.type === 'input_json_delta') {
            b._json += d.partial_json;
            const spec = DRAFTABLE[b.name];
            if (spec) {
              // Full snapshot each time (replace semantics) — the trailing item
              // grows as its text arrives, so the client can render it live.
              const { head, items } = draftScan(b._json, spec.field);
              const sig = items.length + ':' + JSON.stringify(items[items.length - 1] || null).length + ':' + JSON.stringify(head).length;
              if (sig !== b._drafted) {
                b._drafted = sig;
                onEvent({ t: 'draft', app: spec.app, field: spec.field, head, items });
              }
            }
          }
          else if (d.type === 'thinking_delta') {
            b.thinking = (b.thinking || '') + d.thinking;
            // Surface reasoning as it forms: the seconds before the first tool
            // call were the deadest part of a turn.
            onEvent({ t: 'thinking', d: d.thinking });
          }
          else if (d.type === 'signature_delta') b.signature = (b.signature || '') + d.signature;
          break;
        }
        case 'content_block_stop': {
          const b = blocks[ev.index];
          if (b && b.type === 'tool_use') {
            try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; }
            delete b._json;
            delete b._drafted;
          }
          break;
        }
        case 'message_delta':
          if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
          break;
        case 'error':
          throw new Error((ev.error && ev.error.message) || 'stream error');
      }
    }
  }
  return { content: blocks.filter(Boolean), stopReason };
}

/* Our own streaming bookkeeping (_json, _drafted) must never reach the API —
   it rejects unknown keys on a tool_use block. Strip defensively: a stream cut
   short never fires content_block_stop, so the per-block cleanup can be missed. */
const stripScratch = b => {
  if (!b || typeof b !== 'object') return b;
  const out = {};
  for (const k of Object.keys(b)) if (!k.startsWith('_')) out[k] = b[k];
  return out;
};

/* After a mid-stream refusal fallback, blocks before the final `fallback`
   marker must be echoed without thinking/tool_use blocks. Returns the
   echo-safe content and the set of surviving tool_use ids. */
function echoSafe(content) {
  const lastFb = content.map(b => b.type).lastIndexOf('fallback');
  const kept = [];
  content.forEach((b, i) => {
    if (lastFb >= 0 && i < lastFb && (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use')) return;
    kept.push(stripScratch(b));
  });
  return { content: kept, toolIds: new Set(kept.filter(b => b.type === 'tool_use').map(b => b.id)) };
}

/* ---------- the turn ----------
   opts: { store, sessionId, userContent, kind ('chat'|'event'), emit, signal, layout: {get,set} } */
async function runTurn(opts) {
  const { store, sessionId, userContent, kind, emit, signal } = opts;
  if (!API_KEY) throw new Error('Missing ANTHROPIC_API_KEY (put it in .env)');

  // for UI events the `app` column carries the learner-facing label; the
  // content stays written for the model
  store.addMessage(sessionId, 'user', userContent, kind || 'chat', kind === 'event' ? (opts.label || null) : null);

  const eff = opts.effective || { maxApps: 4, checkinEvery: 'stage', depth: 'balanced', priorKnowledge: 'some', preferredApps: [], confidence: 0, accuracy: null, modality: {} };
  const executors = makeExecutors({
    store, sessionId, emit, layout: opts.layout,
    maxApps: eff.maxApps,
    allowedApps: eff.allowedApps,
    planPlace: eff.planPlace,
    setPreference: opts.setPreference,
    onStepComplete: opts.onStepComplete,
  });
  const msgs = historyMessages(store, sessionId);
  const digest = stateDigest(store, sessionId, opts.layout.get());
  msgs[msgs.length - 1] = {
    role: 'user',
    content: msgs[msgs.length - 1].content + `\n\n[session state]\n${digest}`,
  };
  const systemText = `${SYSTEM}\n\n${profileModel.brief(eff)}`;

  const replyParts = [];
  let iterations = 0;
  const tlog = opts.tlog || audit.turn(sessionId);
  tlog.log('turn_start', { kind: kind || 'chat', content: audit.trim(userContent, 400), model: MODEL });

  while (true) {
    if (++iterations > MAX_ITERATIONS) { tlog.log('max_iterations'); break; }
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      // the stable core is cached; the per-learner block rides after it
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: systemText.slice(SYSTEM.length) },
      ],
      tools: buildTools(), // rebuilt per turn: capabilities can drop out at runtime
      messages: msgs,
      // summarised reasoning drives the live status line while the model works
      thinking: { type: 'adaptive', display: 'summarized' },
    };
    // Safety-classifier declines re-run on the recommended fallback model.
    if (FALLBACKS) body.fallbacks = 'default';
    if (EFFORT) body.output_config = { effort: EFFORT };

    const { content, stopReason } = await streamMessage(body, signal, d => {
      replyParts.push(d);
      emit({ t: 'say', d });
    }, emit);

    if (stopReason === 'refusal') {
      tlog.log('refusal');
      emit({ t: 'err', m: 'I had to decline that request. Try rephrasing it.' });
      break;
    }

    const { content: echoContent, toolIds } = echoSafe(content);
    const toolUses = echoContent.filter(b => b.type === 'tool_use' && toolIds.has(b.id));
    tlog.log('model_turn', {
      iteration: iterations,
      stop: stopReason,
      tools: toolUses.map(t => t.name),
      text: audit.trim(content.filter(b => b.type === 'text').map(b => b.text).join(''), 200),
    });

    if (stopReason !== 'tool_use' || !toolUses.length) break;

    const results = [];
    for (const tu of toolUses) {
      if (signal.aborted) break;
      let result, isError = false;
      tlog.tool(tu.name, tu.input);
      try {
        const fn = executors[tu.name];
        if (!fn) throw new Error(`unknown tool ${tu.name}`);
        result = String(fn(tu.input || {}));
      } catch (e) {
        result = `Error: ${e.message}`;
        isError = true;
      }
      tlog.toolResult(tu.name, result, !isError);
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, ...(isError ? { is_error: true } : {}) });
    }
    if (signal.aborted) break;

    msgs.push({ role: 'assistant', content: echoContent });
    msgs.push({ role: 'user', content: results });
  }

  const reply = replyParts.join('').trim();
  if (reply) store.addMessage(sessionId, 'assistant', reply, 'chat');
  else if (signal.aborted) store.addMessage(sessionId, 'assistant', '*(interrupted)*', 'chat');
  tlog.end({ iterations, replyChars: reply.length, aborted: signal.aborted, artifacts: store.listArtifacts(sessionId).length });
  return reply;
}

module.exports = { runTurn, MODEL, SYSTEM, stateDigest, historyMessages, echoSafe, streamMessage };
