# Chameleon MVP — architecture

*Written Aug 2026, at the pivot from sales-demo POC to real product.*

## What Chameleon is now

A **goal-oriented personal-enablement workspace**: you tell the agent what you
want to learn, it builds a **lesson plan** (a checklist of goals you can see and
mark off), and it teaches you — opening, filling and rearranging learning tools
on the adaptive grid, one thing at a time, quizzing you and adapting the plan as
you progress. Think NotebookLM's grounding + a live tutor + the Chameleon
canvas.

The sales demo (the original POC) is preserved read-only under `demo/`, served
at `/demo/`. Nothing in it is imported by the real app. The only things carried
forward are the **UI behaviors**: the grid solver, tile drag/resize physics,
the design system, and streamed agent actions.

The six UX Commandments in [CLAUDE.md](../CLAUDE.md) are the constitution.

## Repo layout

```
server.js            entry point — requires server/index.js  (node server.js)
server/
  index.js           HTTP server, static files, route dispatch (app + demo)
  env.js             .env loader (shared)
  db.js              node:sqlite open + schema migrations
  store.js           all reads/writes: sessions, messages, plans, sources,
                     artifacts, quiz attempts, workspace snapshots
  agent.js           the Anthropic agent loop — streaming, multi-tool,
                     executes tools server-side, emits SSE events
  tools.js           tool schemas + executors (the agent's hands)
  tts.js             ElevenLabs synthesis + on-disk audio cache
  api.js             route handlers: /api/* (REST + SSE)
demo/                the frozen sales POC — served at /demo/, own /demo/api/*
  chat.js crm.js routes.js public/
public/              the real app
  index.html
  style.css          design system (tokens carried over from the POC)
  layout.js          grid solver — UNCHANGED from the POC (shared w/ tests)
  apps.js            learning-app registry + renderers
  chat.js            fused composer + history + stop control
  main.js            orchestrator: tiles, drag/resize, SSE client, action queue
data/                (gitignored) chameleon.db + audio/ cache
test/                node --test: solver, store, agent protocol, tts cache
docs/                this file
```

Zero npm dependencies stays. Node **24+** required (`node:sqlite`).

## Backend

### Storage (`node:sqlite`, `data/chameleon.db`)

One DB, one process — same constraint as savky.dev's proxy. Tables:

- **session** — a learning journey (`id, title, layout_json, created_at, updated_at`).
  The workspace layout snapshot lives here so reload restores the canvas.
- **message** — full chat history (`session_id, role, kind, content, app, created_at`).
  `kind` distinguishes `chat` / `narration` (agent talking inside an app window,
  mirrored here per commandment 3) / `event` (user did something in an app).
- **plan** + **plan_task** — the spine (commandment 6). A plan has ordered
  tasks; each task has a `stage` int — tasks sharing a stage are parallel,
  stages are sequential — plus `status` (todo/doing/done) and `detail`.
  Latest plan per session is the active one.
- **source** — the notebook (`kind` text/url/note, `title`, `content`). URL
  sources are fetched server-side and reduced to text. The agent treats sources
  as ground truth, the same way the POC treated the CRM.
- **artifact** — generated learning content (`app` lesson/flashcards/quiz/podcast,
  `title`, `data` JSON). Tiles render artifacts; artifacts survive reload.
- **quiz_attempt** — answers + score per quiz artifact, so the agent sees what
  you got wrong and adapts the plan.

### Agent loop (`agent.js`) — the real change from the POC

The POC forced one `update_workspace` tool call and made the *client* parse the
streaming JSON. The MVP runs a **real server-side tool loop**:

1. Build context: system prompt + sources digest + active plan + workspace
   snapshot + recent history (persisted, not client-supplied).
2. Stream from the Messages API. Text deltas forward to the client as `say`
   events. When a `tool_use` block completes, its **executor** runs server-side
   (persist artifact, update plan, record layout change), and a semantic event
   is emitted to the client.
3. On `stop_reason: "tool_use"`, append `tool_result`s and continue the loop;
   on `end_turn`, persist the assistant message and emit `done`.
4. The whole loop is under an `AbortController` — when the client disconnects
   (the user hit stop — commandment 4/1), the upstream request aborts and the
   turn is recorded as interrupted.

Tools (all inputs validated; executors in `tools.js`):

| tool | effect |
|---|---|
| `update_plan` | create/replace the plan, or set task statuses; emits `plan` |
| `open_app` / `close_app` / `resize_app` / `focus_app` | layout actions; emit `action` |
| `narrate` | say something *inside* an app window; persisted to history |
| `create_lesson` | markdown lesson artifact (sections) → opens the lesson app |
| `create_flashcards` | deck artifact |
| `create_quiz` | quiz artifact (multiple-choice w/ explanations + free-response) |
| `create_podcast` | two-host script artifact; audio synthesized on demand |
| `add_note` | append a note source to the notebook |

SSE protocol to the client:
`{t:'say', d}` · `{t:'action', a}` · `{t:'narrate', app, text}` ·
`{t:'plan', plan}` · `{t:'artifact', app, artifact}` · `{t:'done'}` · `{t:'err', m}`.

The client **plays these one at a time** (commandment 2): a serialized queue
with ~700 ms pacing, each step visually focused. The server streams as fast as
it can; pacing is presentation, not backpressure.

User interactions inside apps (checked a task, answered a quiz, clicked a
section) POST as events; they become `[UI EVENT]` user turns exactly like the
POC — that pattern worked and stays.

### TTS (`tts.js`)

ElevenLabs, key in `.env` (`ELEVENLABS_API_KEY`). `POST /api/tts` synthesizes
one podcast line (text+voice), cached at `data/audio/<sha256>.mp3`, served at
`/api/audio/<hash>`. Two host voices; the client plays the script as a playlist
of per-line clips (no server-side audio stitching — zero-dep).

## Frontend

### Chat (commandments 1, 4, 5)

The POC's four morphing chat modes are **gone**. One fused surface: a centered
bottom composer, always present; the history column rises above it when
conversing. When the agent starts acting in apps, **history slides away** —
the workspace is the focus, narration happens in the app windows — leaving the
composer with a working indicator that **is the stop button**. When the turn
ends (or is stopped), history returns, including the mirrored narrations.
Empty session = centered hero with the big input.

### Action queue (commandment 2)

All agent events enter one queue. One step at a time: apply the layout change
or narration, focus the touched tile, ring it (the POC's hue-tinted sonar
waves), wait ~700 ms, next. The stop button flushes the queue and aborts the
stream. Nothing in the UI ever animates two agent steps at once.

### Learning apps (`apps.js` registry — same spec shape as the POC)

| app | what it is | interactivity |
|---|---|---|
| `plan` | the lesson plan: staged checklist, progress ring, current task lit | check/uncheck → event; agent adapts |
| `sources` | the notebook: paste text, add URL (server-fetched), notes | add/remove → agent re-grounds |
| `lesson` | rendered markdown lesson, sectioned | click a section → "go deeper" event |
| `quiz` | MC with instant check + explanations; free-response graded by agent | submit → event with answers; score persists |
| `flashcards` | deck with flip; "got it / again" spaced repetition-lite | deck state persists; "harder" → event |
| `podcast` | two-host audio overview, chapter list, real ElevenLabs playback | chapter click → event |

Tile chrome, drag-anywhere move/resize, min-size guides, shake + sonar,
`solve()` — all carried over from the POC unchanged in behavior.

## Decisions & non-goals (MVP)

- **No auth yet.** Same posture as the POC. Before promoting the public
  `/cmln` link beyond friendly traffic, add a simple password gate (like
  bar.savky.dev). Tracked, not built.
- **No accounts/multi-user.** One person's workspace per deployment.
- **Sessions are cheap**: a topbar switcher lists journeys, creates new ones.
- **Model**: `CHAMELEON_MODEL` env (Anthropic), prompt-cached system block.
- **The demo is frozen.** Bug reports against `/demo/` are wontfix.
