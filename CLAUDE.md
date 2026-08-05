# Chameleon — guide for agents

A **goal-oriented AI learning workspace**: you say what you want to learn, the
agent builds a visible lesson plan and teaches it, reshaping the UI as it goes.
Being built into a **company** (Kyle + partner). See [README.md](README.md) to
run it and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

The original adaptive **sales** workspace is frozen under `demo/` (served at
`/demo/`). It was the POC that proved the interaction model; the real app
imports nothing from it. Don't fix bugs there, and don't add features to it.

## UX Commandments

These are the founders' product principles. Every UX decision must be checked
against them; when a feature conflicts with a commandment, the commandment wins.

1. **Implicit permission, not explicit permission.** The agent does things
   automatically — it never stops to ask "may I?". The user's control comes
   from being able to **interrupt** at any moment, not from pre-approving.

2. **The agent does one thing at a time.** Multiple things happening at once is
   signal overload — like three people talking at you simultaneously, it all
   becomes noise. Actions play out sequentially, one focus at a time.

3. **The agent narrates inside the app windows.** While configuring an app, the
   agent can tell you things *in that app's window*. Those messages are also
   recorded in the chat history.

4. **Interruption lives in the chat input box.** While the agent is configuring
   things, the loading indicator in the chat input is the stop control — the
   user interrupts by stopping it.

5. **Input box and chat history are fused — and history yields to action.**
   They are one surface, but the history disappears while the agent is doing
   things in apps (one thing at a time: the workspace is the focus, not the
   transcript).

6. **The agent makes plans in support of the user's goals.** Plans contain
   tasks that can be parallel or sequential. **They are goals the system
   progresses *with* the user — not a to-do list handed to them.** The agent
   drives the plan forward as it teaches; the user can steer, but nothing waits
   on them ticking a box. Always show which goal is live right now.

7. **Never make the user wait to see what's happening.** The moment the agent
   starts something, the user sees it start: the app window opens first and
   says what's being made, and the content streams in as it is written — quiz
   questions appearing one by one, not a spinner then a finished block. Status
   of this kind is **ephemeral**: it lives in the app window and vanishes when
   the work lands. It never becomes chat history (that's what narration is
   for).

## Where each commandment lives in the code

| # | Implementation |
|---|---|
| 1 | No confirmation paths anywhere. `POST /api/chat` aborts on client disconnect; a new turn for a busy session **takes over** the old one (`takeover()` in `server/api.js`) rather than erroring. |
| 2 | `playQueue()` in `public/main.js` — every server event enters one queue and plays with ~700ms spacing, one focus at a time. The server also drops no-op re-opens (`applyLayoutActions`). |
| 3 | The `narrate` tool (`server/tools.js`) → `narrateInTile()` overlay + mirrored into `message` rows with `kind='narration'`. |
| 4 | `body.busy` turns the send button into the stop button (`style.css`); `Chat.stop()` aborts the fetch and fast-forwards the queue. |
| 5 | **The agent is a layer, not a window.** Docked left by default; on a side dock the card, border and shadow are dropped entirely (`body.place-left #chatdock.fused`) so the conversation simply occupies its column. Agent replies are plain text — only the *learner's* messages keep a bubble, because their turn is an event and the agent's is running commentary. Apps are the things in boxes; the agent is not an app. `#chatdock.fused` is one card holding history + composer; `body.acting` collapses the history away while the queue plays, and `#chat-collapse` hides it on demand. Placement (`place-center/left/right/mini`) moves the whole fused surface — drag the grip, or `?place=` for demo links. |
| 6 | `plan` + `plan_task` tables (stages = parallel/sequential; `done_when` + `apps` per step), the `update_plan` / `complete_step` / `set_task_status` tools, and the `plan` app. The tile leads with a **current-step card** (`.plan-now`): what you are doing, what finished looks like, and "I'm ready" / "I'm stuck". Whether the agent waits on that button is the learner's `checkinEvery` setting, not a global rule. |
| 7 | `server/agent.js` emits `tool_start` the instant a tool call begins and `draft` events parsed from the still-streaming tool input (`draftScan`). The client opens the target tile immediately with an ephemeral status and renders items as they arrive — see `state.draft` in `public/main.js`. |

## Pace is a property of the learner, not of the product

Commandments 1, 2 and 6 pull in opposite directions for different people. One
founder wants one window and a confirmation before every step; the other wants
four windows and no interruptions. **That is not a disagreement to arbitrate —
it is a setting to model.** [docs/ADAPTIVE.md](docs/ADAPTIVE.md) is the design;
the short version:

- **Sign-in is real.** `server/auth.js` (scrypt + HMAC-signed cookie), two
  seeded accounts, and every journey, profile and signal is scoped to a user.
  `mine(sid)` in `server/api.js` guards every route that takes a journey id.
- **One question, once** (`public/gate.js`): *how much at once?* — one thing at
  a time / a steady pace / everything at once. That is the whole of onboarding.
  Everything else is learned from use or said in the chat, because a
  questionnaire in front of someone who wants to start is friction, and the
  answers were guesses anyway. It deliberately never asks how much someone
  already knows: nobody is uniformly a beginner or an expert, so
  `priorKnowledge` is a default the agent overrides per topic.
- **ONE control, and everything hangs off it.** A mode (`simple` / `balanced` /
  `extreme`, see `MODES` in `server/profile.js`) is a named bundle of every
  other setting. The individual parameters still exist, are still tracked, and
  are still changeable behind **Advanced** in the settings sheet — touching one
  just means `modeOf()` reports `custom`. Matt: *"I love that we've got those.
  I don't love that we expose them to users."* The tracking is the product; the
  exposure was the mistake.
- **The plan has two homes, and which one is a setting** (`planPlace`). In the
  conversation (`#chat-plan`, `Apps.chatPlan`) it is something you talk to —
  the current step sits above the composer, the steps are clickable triggers,
  and Ready / I'm stuck are next to the input. In a window it is the `plan` tile
  beside the work. Matt keeps it in chat and gets no plan window at all; Kyle
  keeps it in a window alongside a lesson and a quiz. Enforced: with the spine
  in chat, `update_plan` opens no tile and `layout {open: plan}` is refused.
- **They can coach the UX in chat and it sticks.** The `remember_preference`
  tool writes to the same `stated` profile the settings sheet edits, so "stop
  opening two things at once" and clicking *One* are the same act. It applies
  from the next turn, emits a `preference` event so the UI updates in the same
  breath as the acknowledgement, and lands in the audit trail. A preference the
  learner has to repeat is one we failed to record.
- **The profile has three layers** (`server/profile.js`): `stated` (the
  baseline), `observed` (what they actually do), and `effective` — the blend,
  weighted by how much evidence we have. Only `effective` is ever read at
  runtime, and it crosses the wire in exactly one shape (`shapeProfile`).
- **Pacing is enforced, not requested.** `maxApps` is a hard budget applied in
  `makeExecutors` (`server/tools.js`); an over-budget `layout` open is refused
  with a message the model can act on. A prompt asking for one window at a time
  is a wish; this is the guarantee. The plan window is exempt — it is the spine,
  not a thing to work in.
- **Every step must say what finished looks like.** `update_plan` **refuses** a
  plan whose steps have no `done_when`. A warning would arrive after the learner
  had already been shown a vague plan.
- **The profile learns.** `POST /api/signal` folds behaviour in: closing a
  window within 15s of it appearing, pressing "I'm stuck", pressing "I'm ready",
  quiz scores, which windows get used. Nothing moves on two data points —
  `confidenceOf` needs roughly a dozen completed steps before observation
  outweighs what they told us.
- **Everything is changeable, from one sheet.** The avatar opens a full-height
  settings sheet (`#user-pop`, at body level — the topbar's `backdrop-filter`
  makes it a containing block, which clips a `position: fixed` panel inside it).
  It holds pacing, **where the agent speaks** (`voice`: in the windows / both /
  in chat), how much it says in chat (`chatter`), depth, visual density
  (`visuals`), assumed background, and **which windows it may build at all**
  (`apps`). Plus "Retake the baseline". Anything that can be enforced is —
  `allowedApps` is checked in `makeExecutors` before anything is written, not
  just asked for in the prompt.

## Debugging a hosted session

Every interaction is written to `data/audit.jsonl` (gitignored): the turn and
what was asked, each tool call with its input, each result, API errors, browser
errors, and timings. Read it live at
`/api/log?t=<LOG_TOKEN>&format=text&n=200`, optionally `&session=<id>`. The
token comes from `LOG_TOKEN` in `.env`; without one, a fresh token is minted at
boot and printed to the console. It is gated because the log contains what the
learner typed, verbatim.

The client reports its own failures to the same trail (`/api/client-error`, via
`report()` in `main.js`), because a browser exception used to leave the
workspace frozen with nothing to look at afterwards.

## Checking your work

- `node --test "test/*.test.js"` runs everything. The `ui-*.test.js` files drive
  a **real headless Chrome** through `test/drive.js`, a zero-dependency CDP
  client — it clicks with real mouse events, so it catches z-index and
  pointer-events bugs that a synthetic `.click()` sails past. `page.topAt(sel)`
  proves nothing is covering a control; `page.overflowing()` finds anything
  spilling out of the viewport; `page.errors` fails the test on any uncaught
  browser exception. `serve()` gives each test its own port and throwaway
  database, so they can run in parallel.
- `public/_states.html` renders **every app in every state** — populated, empty,
  drafting, degraded — side by side. Open it (or screenshot it headless) after
  touching any renderer; most visual regressions show up there in one glance.
- Motion has one vocabulary, defined at the top of `style.css`: things enter
  with a little overshoot (`--t-in`, `--ease-out`) and leave quickly and
  quietly (`--t-out`, `--ease-in`). Use `.enter-rise` / `.leave-fall` /
  `.leave-slide` / `.stagger` rather than inventing a new keyframe, and let a
  removal animation finish before the list reflows.
- Never surface internal ids (task, artifact) in anything the learner reads —
  in the UI or in what the agent says.

## Hard constraints

- **Node 24+**, zero npm dependencies. Keep it that way — no framework, no build step.
- **One process, one SQLite file** (`data/chameleon.db`). Never run two instances against it.
- **Generated illustrations are keyed by prompt, never by node.** A tile
  repaints on narration, status changes and resizes, replacing every node in
  it. `mountImages` in `public/richtext.js` caches the in-flight request per
  prompt and paints into whichever node is on screen when it lands — tying the
  request to the node that started it orphaned it on every repaint and left the
  placeholder spinning. The `<img>` must also be inserted **before** its `src`
  is set: a detached image can be deferred indefinitely, so waiting for `onload`
  to insert it was a deadlock.
- **Visual libraries are CDN-loaded, pinned, and lazy.** `public/richtext.js` owns
  the markdown engine and mounts Mermaid 11.16.0, KaTeX 0.18.1, Vega-Lite 6.4.3
  and highlight.js 11.11.1 on first use only. Pin exact versions — floating tags
  have shipped breaking changes on all four. Every mount degrades to readable
  source if the CDN is unreachable, and `<!doctype html>` must stay first in
  index.html or KaTeX silently renders nothing.
- **Decks use a custom viewer, not reveal.js.** The deck is a tile the grid
  resizes constantly, and reveal re-measures hidden slides — the documented
  cause of Mermaid breaking from slide ~4 on. A `.pptx` export via Anthropic's
  `pptx` Agent Skill is the intended next step; that skill is proprietary
  (pptxgenjs under the hood), so call it, never vendor it or copy its rules.
- **Static assets are served with a `?v=` stamp** (`assetVersion` in `server/index.js`). Without it the CDN caches `.js`/`.css` for hours and a deploy ships new HTML against stale scripts. Don't remove the stamping or the `no-cache` header on HTML.
- Secrets live in `.env` (gitignored): `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`.
- The notebook (`source` rows) is ground truth for teaching — never contradict it.
