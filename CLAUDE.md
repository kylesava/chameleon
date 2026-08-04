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
   tasks that can be parallel or sequential. Eventually plans may get their own
   UI surface; initially they just live in the chat history.

## Where each commandment lives in the code

| # | Implementation |
|---|---|
| 1 | No confirmation paths anywhere. `POST /api/chat` aborts on client disconnect; a new turn for a busy session **takes over** the old one (`takeover()` in `server/api.js`) rather than erroring. |
| 2 | `playQueue()` in `public/main.js` — every server event enters one queue and plays with ~700ms spacing, one focus at a time. The server also drops no-op re-opens (`applyLayoutActions`). |
| 3 | The `narrate` tool (`server/tools.js`) → `narrateInTile()` overlay + mirrored into `message` rows with `kind='narration'`. |
| 4 | `body.busy` turns the send button into the stop button (`style.css`); `Chat.stop()` aborts the fetch and fast-forwards the queue. |
| 5 | `#chatdock.fused` is one card holding history + composer; `body.acting` collapses the history away while the queue plays. |
| 6 | `plan` + `plan_task` tables (stages = parallel/sequential), the `update_plan` / `set_task_status` tools, and the `plan` app — the checklist is the spine of every session. |

## Hard constraints

- **Node 24+**, zero npm dependencies. Keep it that way — no framework, no build step.
- **One process, one SQLite file** (`data/chameleon.db`). Never run two instances against it.
- Secrets live in `.env` (gitignored): `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`.
- The notebook (`source` rows) is ground truth for teaching — never contradict it.
