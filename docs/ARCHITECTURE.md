# Chameleon — architecture

The code map. Read [STATE.md](STATE.md) first for what is built and what is
not; read [../CLAUDE.md](../CLAUDE.md) for the product rules that constrain
every change.

---

## The one-paragraph version

You tell an agent what you want to do. Small asks get **answered**. Bigger ones
get a **plan** — a visible spine of steps — which the agent works through with
you, opening **app windows** (lesson, quiz, flashcards, deck, podcast, notebook)
on an adaptive grid and narrating as it goes. The **conversation is the
background**; apps float on top of it. How much happens at once, whether it
waits for you, and where the plan lives are **per-user settings** the agent can
learn or simply be told.

One Node process, one SQLite file, zero npm dependencies, no build step.

---

## Repo layout

```
server.js              entry point — requires server/index.js
server/
  index.js             HTTP server, static files, route dispatch, user seeding
  api.js               every /api/* route, the SSE turn, ownership guards
  agent.js             the SYSTEM prompt + the streaming tool-use loop
  tools.js             tool schemas + executors (the agent's hands)
  profile.js           the learner model: modes, stated/observed/effective
  auth.js              scrypt passwords, HMAC cookie sessions
  store.js             all reads and writes
  db.js                node:sqlite open + idempotent migrations
  env.js               .env loader (process env wins)
  images.js            generated illustrations (Gemini / OpenAI)
  tts.js               ElevenLabs podcast audio
  log.js               JSONL audit trail
public/
  index.html           the whole DOM
  main.js              orchestrator: state, layout, the action queue, settings
  chat.js              the conversation surface + SSE reader + pinning
  apps.js              app registry + every renderer + the chat-resident plan
  annotate.js          mark anything in an app and talk to the agent about it
  richtext.js          markdown engine + lazy Mermaid/KaTeX/Vega/hljs mounting
  layout.js            the grid solver
  gate.js              sign-in
  style.css            everything visual
test/
  drive.js             zero-dependency Chrome DevTools driver (see below)
  *.test.js            unit + browser tests
  persona-*.test.js    whole journeys against the live API (PERSONA=1 only)
tools/reset-demo.js    put the demo accounts back to a first-visit state
demo/                  the frozen sales POC, served at /demo/. Do not touch.
```

---

## Backend

### The turn

`POST /api/chat` opens an **SSE stream** and runs `runTurn` in `agent.js`:

1. Build the system prompt: a **cached** block (`SYSTEM`) plus an uncached
   per-learner **brief** from `profile.brief(effective)`.
2. Stream from the Messages API with tool use.
3. As each tool call's input streams in, `draftScan` parses the partial JSON and
   emits `draft` events — that is how a quiz appears question by question rather
   than after a spinner (commandment 7).
4. Execute the tool, emit its effects, feed the result back, repeat.

Events on the wire: `thinking`, `tool_start`, `draft`, `action`, `plan`,
`artifact`, `narrate`, `source`, `preference`, `say`, `err`, `done`.

The client turns `action`/`plan`/`artifact`/`narrate` into a **one-at-a-time
queue** (commandment 2). `thinking`/`tool_start`/`draft` bypass it, because they
are a live view of the current step rather than a competing step.

A new turn for a busy session **takes over** the old one (`takeover()`) rather
than erroring — interruption, not rejection (commandment 1).

### Enforcement, not persuasion

Anything a model could talk itself out of is checked in `makeExecutors`
(`tools.js`) **before anything is written**:

| Rule | Where |
|---|---|
| At most `maxApps` working windows per turn | `withinBudget` / `chargeFor` |
| Windows the learner switched off are unavailable | `permitted` / `notAllowed` |
| The plan window is exempt from the budget | `permitted('plan')` |
| The agent may not close the plan window | `layout` executor |
| With the plan in chat there is no plan tile at all | `planInChat` |
| Every step must carry a `done_when` | `update_plan` throws |
| Nothing is persisted before those checks pass | each `create_*` |

A thrown executor error comes back as an `is_error` tool result, so the model
sees the refusal and corrects itself inside the same turn.

### Data

One SQLite file, `data/chameleon.db`. Tables: `user`, `session`, `message`,
`plan`, `plan_task`, `source`, `artifact`, `quiz_attempt`, `signal`.

`user.profile_json` holds the learner model. Everything else hangs off
`session`, and **every route that takes a session id goes through `mine(sid)`**
in `api.js` — one guard applied everywhere, so a stale or guessed id cannot
reach another user's work.

### The learner model (`profile.js`)

Three layers:

- **`stated`** — what they chose, or were coached into.
- **`observed`** — what they actually do: windows closed within 15s, "I'm
  stuck", "I'm ready", quiz scores, which windows get used.
- **`effective`** — the blend, weighted by `confidenceOf` (roughly a dozen
  completed steps before observation outweighs what they said).

**Only `effective` is read at runtime**, and it crosses the wire in exactly one
shape (`shapeProfile` in `api.js`): `{ onboarded, stated, effective }`.

A **mode** is a named bundle of every tuned parameter — `slow-walk`, `walk`,
`run`, `sprint`, in that order — rendered as one dial. `modeOf()` derives which
one a profile matches, or `custom` when hand-tuned.

---

## Frontend

### The surface

**The conversation is the canvas.** The transcript is text painted across the
background *underneath* the app windows; the composer is the only container.
Apps are opaque and float on top, so as they fill the screen they cover the
conversation — that is the "dissolve", not a rule that hides it.

Where the transcript sits follows the work, not a preference:

- nothing open → centred
- any app open → a column on the left, until the last window closes
- folded → collapses into the left wall as a chameleon tab; click to restore

The plan, when it lives in the conversation, is a **pinned message at the top of
that column** — same place as everything else the agent says. The composer is
separately dockable (`place-center/left/right/mini`).

> **Stacking gotcha.** `#chatdock` must not set a `z-index`, or it creates a
> stacking context its children can never escape — they cannot rise above
> `.tile` (z-index 2) however high their own z-index. The transcript sits at 1,
> the agent's furniture at 5, and the dock itself takes no part.

> **Measurement gotcha.** `metrics()` must measure the element the tiles are
> positioned inside (`#workspace`), not the stage around it. When the two
> disagree, tiles are drawn wider than the box holding them. And when the
> transcript holds the left column the grid must be both narrowed **and**
> shifted — narrowing alone draws tiles underneath it.

> **Click-through gotcha.** The dock is `pointer-events: none` so the canvas
> stays reachable; every interactive child must opt back in.

> **Re-render gotcha.** `renderHistory` clears `#chat-log`. Anything that must
> survive a history re-render lives in `#chat-log-wrap`, outside it — which is
> where `#chat-plan` sits.

### The action queue

Every server event enters one queue in `main.js` and plays with deliberate
spacing, one focus at a time. `playQueue`'s `finally` is a **safety net for a
crashed queue, not a turn-end detector** — the queue runs dry many times during
a normal turn, so it checks `Chat.streaming()` before settling. Getting this
wrong retires the stop button mid-turn and lets a follow-up message abort the
running one, freezing a half-written window.

`chatPlan()` repaints on every streamed draft frame, so `planResized` only
relayouts when the spine's height actually changes — otherwise the windows
strobe while a plan is being written.

### Apps

`REGISTRY` in `apps.js` defines each app's grid sizes, icon, hue and
description; `R.<app>(el, app)` renders it from session state. Adding an app
means a registry entry, a renderer, and a `create_<app>` tool.

The plan has **two renderers** — `R.plan` (the window) and `chatPlan` (the
conversation) — but **one set of actions** (`STEP.advance/stuck/jump`), so the
two homes cannot drift apart in what they tell the agent.

### Annotations (`annotate.js`)

Select text inside a tile, or alt-click an element, and a composer appears
anchored to it. Send one immediately, or add to a batch and submit together. The
agent receives one message quoting exactly what was marked.

> Event targets are not always elements — `mouseup` can land on the document or
> a text node, and `.closest()` on those throws and kills the listener. Hence
> the `within()` helper.

### Generated illustrations

Requests are keyed by **prompt, not by node**. A tile repaints on narration,
status changes and resizes, replacing every node in it — a request tied to its
node is orphaned on every repaint while the placeholder spins forever. Also: the
`<img>` must be inserted **before** its `src` is set, because a detached image
can be deferred indefinitely, so waiting for `onload` to insert it deadlocks.

---

## Testing

`test/drive.js` is a **zero-dependency Chrome DevTools Protocol driver**. It
clicks with real mouse events, so z-index and pointer-events bugs cannot hide
behind a synthetic `.click()`.

```js
const { open, serve, sleep, pickPace } = require('./drive.js');
const app = await serve();              // own port, own throwaway database
const br  = await open({ headless: true });
const p   = await br.page(app.url + '/');
```

Page methods: `waitFor`, `click`, `fill`, `type`, `key`, `drag`, `box`, `text`,
`count`, `has`, `eval`, `shot`, plus the ones that catch layout bugs:

- **`topAt(sel)`** — what is actually on top at that element's centre. Proves
  nothing covers a control. Scrolls it into view first.
- **`coveredTiles()`** — which app windows the composer sits on top of.
- **`overflowing()`** — anything spilling out of the viewport.
- **`p.errors`** — uncaught page exceptions. Assert this is empty.

`serve()` and `open()` both use **ephemeral ports**. Fixed ports meant a server
left behind by a killed run was still listening, the next run silently attached
to it, and tests failed against a stranger's database — which reads as flakiness
and is not.

`persona-*.test.js` drive whole journeys against the live API and are skipped
unless `PERSONA=1`, so the documented test command costs nothing.

### Debugging a hosted session

Every interaction goes to `data/audit.jsonl`: the turn, each tool call with its
input, each result, API errors, browser errors, timings. Read it live at
`/api/log?t=<LOG_TOKEN>&format=text&n=200`. The client reports its own failures
to the same trail via `/api/client-error`.

`window.__cham` exposes `sessionId()`, `profile()`, `plan()`, `open()` and
`trace()` — the last a rolling log of every event the client received, which
distinguishes "the event never arrived" from "the client dropped it".

---

## Deliberate non-goals

- **No build step, no npm dependencies.** Node 24's `node:sqlite` and global
  `fetch`/`WebSocket` are enough. Keep it that way.
- **No framework.** One orchestrator and a few renderers is less code than the
  alternative at this size.
- **One process, one database.** Never run two instances against the same file.
- **Visual libraries are CDN-loaded, pinned and lazy** — Mermaid 11.16.0,
  KaTeX 0.18.1, Vega-Lite 6.4.3, highlight.js 11.11.1. Pin exact versions;
  floating tags have shipped breaking changes on all four.
- **Decks use a custom viewer, not reveal.js** — reveal re-measures hidden
  slides, the documented cause of Mermaid breaking from slide ~4 on.
- **`demo/` is frozen.** It proved the interaction model. Do not fix bugs in it.
