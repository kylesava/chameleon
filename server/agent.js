/* The real agent loop (the pivot from the POC's forced-single-tool trick):
   streaming Messages API, multi-tool, executed server-side, semantic SSE
   events to the client. Zero-dep: raw fetch + hand-rolled SSE parsing. */

const { ENV } = require('./env.js');
const { TOOLS, makeExecutors, DRAFTABLE, TOOL_STATUS, draftScan } = require('./tools.js');

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
- Narrate INSIDE the app you are working on (the narrate tool) — short lines like "Building your plan — check off what you already know." These mirror to chat history.
- Your final text reply is shown in the chat history AFTER your workspace actions finish. Keep it short and warm: what you set up, what to do next. The tiles carry the content; the reply carries the direction.
- NEVER MAKE THEM WAIT TO SEE WHAT'S HAPPENING. The moment you start a create_* or update_plan tool, its app opens and its content streams in as you write it — the learner watches questions and sections appear. So write in a natural reading order (first question first), and don't apologise for or announce latency.

THE PLAN IS SHARED PROGRESS, NOT A TO-DO LIST YOU HAND OVER. You drive it: as you teach a goal, mark it "doing" (set_task_status) BEFORE you build the thing that serves it, and mark it "done" once the learner has actually shown it stuck — not merely been shown it. Exactly one task should be "doing" at a time; that is the "now" marker the learner steers by. Never park the plan waiting for them to tick a box; ticking is their override, not your trigger.

THE SPINE: GOALS. Every journey runs on a lesson plan (update_plan) — a visible checklist the learner works through and checks off. Create one as soon as you understand the goal (2-3 stages, 3-8 tasks). When the learner checks a task, answers a quiz, or asks for something new, update task statuses and adapt: advance the plan, revise the lesson, add practice. The plan is a living object, not a formality.

THE WORKSPACE: an 8x6 grid of tiles. Sizes: s / m / l / xl (hero). Apps:
- plan — the checklist (auto-renders the current plan)
- sources — the learner's notebook: pasted text, fetched URLs, and your notes (add_note). GROUND TRUTH: when sources exist, teach from them, cite them, never contradict them.
- lesson — your written lesson (create_lesson), sectioned markdown. The learner clicks a section to go deeper.
- quiz — interactive check (create_quiz): mc questions auto-grade in the UI; free questions come back to you to grade.
- flashcards — spaced practice deck (create_flashcards); the learner marks got-it/again.
- podcast — a two-host audio overview (create_podcast) with real synthesized voices.

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
    throw new Error(err?.error?.message || `Anthropic API error (${up.status})`);
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
          else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + d.thinking;
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

  store.addMessage(sessionId, 'user', userContent, kind || 'chat');

  const executors = makeExecutors({ store, sessionId, emit, layout: opts.layout });
  const msgs = historyMessages(store, sessionId);
  const digest = stateDigest(store, sessionId, opts.layout.get());
  msgs[msgs.length - 1] = {
    role: 'user',
    content: msgs[msgs.length - 1].content + `\n\n[session state]\n${digest}`,
  };

  const replyParts = [];
  let iterations = 0;

  while (true) {
    if (++iterations > MAX_ITERATIONS) break;
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      stream: true,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: msgs,
    };
    // Safety-classifier declines re-run on the recommended fallback model.
    if (FALLBACKS) body.fallbacks = 'default';
    if (EFFORT) body.output_config = { effort: EFFORT };

    const { content, stopReason } = await streamMessage(body, signal, d => {
      replyParts.push(d);
      emit({ t: 'say', d });
    }, emit);

    if (stopReason === 'refusal') {
      emit({ t: 'err', m: 'I had to decline that request. Try rephrasing it.' });
      break;
    }

    const { content: echoContent, toolIds } = echoSafe(content);
    const toolUses = echoContent.filter(b => b.type === 'tool_use' && toolIds.has(b.id));

    if (stopReason !== 'tool_use' || !toolUses.length) break;

    const results = [];
    for (const tu of toolUses) {
      if (signal.aborted) break;
      let result, isError = false;
      try {
        const fn = executors[tu.name];
        if (!fn) throw new Error(`unknown tool ${tu.name}`);
        result = String(fn(tu.input || {}));
      } catch (e) {
        result = `Error: ${e.message}`;
        isError = true;
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: result, ...(isError ? { is_error: true } : {}) });
    }
    if (signal.aborted) break;

    msgs.push({ role: 'assistant', content: echoContent });
    msgs.push({ role: 'user', content: results });
  }

  const reply = replyParts.join('').trim();
  if (reply) store.addMessage(sessionId, 'assistant', reply, 'chat');
  else if (signal.aborted) store.addMessage(sessionId, 'assistant', '*(interrupted)*', 'chat');
  return reply;
}

module.exports = { runTurn, MODEL, SYSTEM, stateDigest, historyMessages, echoSafe, streamMessage };
