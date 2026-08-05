# Where things stand

Last updated 5 Aug 2026. Read this before changing anything — it is the list of
what is real, what is half-built, and what will waste your afternoon.

For the code map see [ARCHITECTURE.md](ARCHITECTURE.md). For the product rules
that constrain every change see [../CLAUDE.md](../CLAUDE.md). For why the
learner model exists at all see [ADAPTIVE.md](ADAPTIVE.md).

---

## Start here

```bash
node server.js                 # → http://localhost:8787, and savky.dev/cmln
node --test "test/*.test.js"   # 128 tests, ~7 min
node tools/reset-demo.js       # both accounts back to a never-seen-it state
```

Accounts: **matt / OldGuy**, **kyle / YoungGuy**. Everyone starts on `walk`.

**Run `tools/reset-demo.js` before showing anyone anything.** Completing a
journey is exactly what a test run does, so the accounts drift out of a
first-visit state constantly.

---

## What is actually built and verified

- **Sign-in, per-user everything.** Journeys, profile and signals are scoped to
  a user; one guard (`mine(sid)`) on every route that takes a session id.
- **Answer-or-plan triage.** Small asks are answered in chat with no plan and no
  windows; work with several sittings gets a plan. Measured 5/5 in `slow-walk`
  and 5/5 in `sprint`.
- **The plan as a spine.** Every step carries a `done_when`; `update_plan`
  refuses a plan without one. Exactly one step is live. "I'm ready" advances
  exactly one step; "I'm stuck" never advances.
- **Two homes for the plan** — in the conversation (pinned at the top of the
  transcript) or in its own window. `planPlace`, per user.
- **The pace dial** — `slow-walk / walk / run / sprint`. One control; every
  parameter hangs off it. Individual settings live behind **Advanced**.
- **Coaching from chat.** "Slow right down", "put the plan in the chat", "I
  never want podcasts" all write to the same profile the settings sheet edits,
  take effect immediately, and survive a reload. Verified live.
- **The conversation is the canvas** — transcript painted on the background
  under the windows, composer the only container, centre when nothing is open,
  left column when something is, foldable to a tab on the left wall.
- **Annotations.** Select text or alt-click an element in any app, type an
  instruction or a question, send it alone or batch several. UI verified end to
  end.
- **Generated illustrations** render (they never had, before — two independent
  bugs, both fixed).

---

## Known unfinished

**The review flow after annotations.** Matt's spec: once you send marks, the
agent should come back with *"here's what you asked for, here's what I've done
— want to review?"* and a button that folds the conversation and takes the app
full screen. The plumbing exists (`chameleon:fullscreen` folds the transcript to
the tab), but nothing triggers it. This is the most concrete remaining gap.

**Annotations against a live agent turn.** The UI is tested; I have not
confirmed the agent actually revises artifacts in place from a real batch.
Try it first.

**Agents editing their own behaviour.** Kyle's stated direction, deliberately
not started. `remember_preference` writes to a fixed set of settings — real
self-modification (the agent editing its own prompt, tools or app definitions)
needs decisions about sandboxing and rollback before anyone improvises it.

**Verticalised packaging.** Same platform, per-industry packs rather than
separate products. Nothing blocks it — the education tuning lives in the prompt
and the app registry, which is where a pack would go. A go-to-market decision,
not a code one.

**Who this is for.** Matt reads it as SMB / mid-market, non-technical. That is
the argument behind `slow-walk` being a real mode rather than a courtesy. Not
settled between the two founders.

---

## Things that will waste your afternoon

Each of these cost real time. They are all documented in
[ARCHITECTURE.md](ARCHITECTURE.md) too, but they are worth repeating.

| Symptom | Cause |
|---|---|
| A control is unclickable and `topAt` says it is covered | `#chatdock` set a `z-index`, creating a stacking context its children cannot escape. The dock takes no part in stacking; the transcript is 1, the agent's furniture 5. |
| Tiles run off the right of the screen | `metrics()` measured the stage while tiles are positioned inside `#workspace`. Measure the box the tiles live in. |
| Tiles are drawn underneath the transcript | The grid was narrowed but not shifted. It needs both. |
| A button silently does nothing | The dock is `pointer-events: none` so the canvas stays reachable; every interactive child must opt back in. |
| Windows strobe while a plan streams in | `chatPlan()` repaints on every draft frame, and it used to relayout each time. Only a real change in the spine's height may move the grid. |
| The turn "ends" while the agent is still working | `playQueue`'s `finally` is a safety net for a crashed queue, not a turn-end detector. It must check `Chat.streaming()`. |
| An illustration spins forever | Requests must be keyed by prompt, not by node, and the `<img>` must be in the DOM before its `src` is set. |
| Tests fail for no reason | A server from a killed run still held a fixed port and the next run attached to it. Both `serve()` and `open()` now use ephemeral ports — do not reintroduce fixed ones. |
| An event listener stops firing | `mouseup` can land on the document or a text node; `.closest()` on those throws. Use `within()`. |
| The plan element disappears | `renderHistory` clears `#chat-log`. Anything that must survive a history re-render lives in `#chat-log-wrap`, outside it. |

---

## Working on this repo

- **Zero npm dependencies, no build step, Node 24+.** Do not add either.
- **Run the full suite before pushing.** It is slow (~7 min) because it drives a
  real browser, and that is the point.
- **Look at the screenshots.** `data/shots/` fills up as the browser tests run.
  Reading them catches what assertions do not.
- **Deploy is `node server.js` on this box**, behind the savky.dev tunnel at
  `/cmln`. Restart it to pick up changes; asset URLs are stamped so a deploy
  lands atomically.
- **Branch is `adaptive-learner-profile`**, PR #1 against `main`. `main` has
  none of this work yet.
