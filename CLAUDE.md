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
| 5 | `#chatdock.fused` is one card holding history + composer; `body.acting` collapses the history away while the queue plays, and `#chat-collapse` hides it on demand. Placement (`place-center/left/right/mini`) moves the whole fused surface — drag the grip, or `?place=` for demo links. |
| 6 | `plan` + `plan_task` tables (stages = parallel/sequential), the `update_plan` / `set_task_status` tools, and the `plan` app. The agent is told to advance statuses itself as it teaches; the tile leads with the live goal. |
| 7 | `server/agent.js` emits `tool_start` the instant a tool call begins and `draft` events parsed from the still-streaming tool input (`draftScan`). The client opens the target tile immediately with an ephemeral status and renders items as they arrive — see `state.draft` in `public/main.js`. |

## Checking your work

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
