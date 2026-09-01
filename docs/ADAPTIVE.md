> **Note.** This document grew as a series of updates, newest at the bottom.
> For the *current* state of the product read [STATE.md](STATE.md); for the code
> map read [ARCHITECTURE.md](ARCHITECTURE.md). What follows is the reasoning
> behind the learner model, kept because the reasoning is the valuable part.

# Adapting to the person — design

*Written Aug 2026, from Matt's feedback after the first hosted play-through.*

## The finding

Matt and Kyle used the same build and wanted opposite things.

- **Matt:** "there is too much happening, faster than I can absorb… the agent
  is opening the quiz which is distracting me from focusing on the lesson —
  these are not things I will do simultaneously." He wants one step, time to
  work, then a check-in before the next.
- **Kyle:** "I do actually have like 6 apps up at once… it jumping around like
  that is super satisfying to me… I prefer it launching a lesson with a quiz
  and a plan."

Both are right about themselves. The mistake was having a single global
answer. **Pace and parallelism are properties of the learner, not of the
product.** So Chameleon learns them — starting from a short baseline at signup
and adjusting from what the person actually does.

This is also the honest reading of commandment 2. "One thing at a time" is
about **not overwhelming the person in front of you**. For Matt that means one
app. For Kyle it means one *step* that may legitimately open three windows.
The rule is unchanged; the unit is per-person.

## The learner profile

One JSON document per user, three layers. Only `effective` is read at runtime.

```
stated     what they told us          (onboarding, and anything they say later)
observed   what they actually do      (accumulated signals, decayed over time)
effective  what the agent is given    (derived from both; stated wins early,
                                       observed takes over as evidence builds)
```

### stated (from onboarding, 5 questions)

| field | values | question behind it |
|---|---|---|
| `pace` | `guided` · `blended` · `firehose` | one step at a time, or everything at once? |
| `parallelism` | 1–4 | how many windows at once feels good |
| `checkins` | `every-step` · `every-stage` · `rarely` | should I confirm before moving on? |
| `depth` | `concise` · `balanced` · `thorough` | how much detail per lesson |
| `modality` | weights over reading / diagrams / practice / audio | what actually helps them |

### observed (accumulated, never edited by hand)

Counters and rates, plus `lastUpdated`. Chosen because each maps to a decision
the agent makes:

| signal | what it means | moves |
|---|---|---|
| `tilesClosedFast` | user closed a tile within 20s of the agent opening it | parallelism ↓ |
| `advanceRequests` | "next", "ready", Continue clicks | checkins ↓, pace ↑ |
| `slowDownSignals` | "wait", "too fast", "one at a time" | parallelism ↓, checkins ↑ |
| `secondsPerStep` | median time between step start and completion | pace |
| `quizAccuracy` | rolling accuracy | depth ↑ when low |
| `modalityUse` | which apps they actually engage with | what to build next time |
| `stepsCompleted` | volume of evidence | confidence weight |

### effective (what the prompt sees)

Derived per turn:

```
maxApps          hard budget on windows opened in one turn
checkinEvery     'step' | 'stage' | 'never'
depth            concise | balanced | thorough
preferredApps    ordered by observed engagement
confidence       0..1 — how much observation is behind this
```

`effective` starts as a direct read of `stated`. As `stepsCompleted` grows,
observed signals are blended in with weight `min(1, stepsCompleted / 12)`, so
early sessions honour what they told us and later sessions honour what they do.

## Pacing is enforced, not requested

A prompt asking the model to open one window is a wish. The **app budget is
enforced in the executors**: once a turn has opened `maxApps` windows, further
opens return an error the model can read —

> Budget reached: this learner works one window at a time. Finish with what is
> open, or close something first.

— which it can then respond to sensibly. That is the difference between a
guideline and a guarantee, and it is what makes Matt's experience reliable
rather than probabilistic.

The same mechanism gives Kyle his firehose: his budget is 4.

## The plan is the spine, and the spine must be legible

Kyle: *"that's the weakest point right now because it's so fundamental to the
rest of the experience and that shit is far too much guesswork."*

The guesswork was that a step said what it was **about** but never what you
were supposed to **do**, or how anyone would know it was finished. Every step
now carries:

- `title` — the goal, in the learner's language
- `detail` — one line of why it matters
- `done_when` — the observable thing that ends it ("you can trace one carbon
  atom from glucose to CO₂ without looking")
- `apps` — which window(s) this step lives in

The current step is a card, not a row: what you're doing, how it's checked,
and two buttons — **I'm ready for the next step** and **I'm stuck**. Advancing
is an explicit act by the learner in guided mode; in firehose mode the agent
advances on its own and the buttons are still there.

## Auth

Minimal but real, because the profile is per-person and a shared workspace
would mix two people's learning.

- `user` table, scrypt-hashed passwords (`node:crypto`, per-user salt,
  `timingSafeEqual`).
- Signed cookie session (`HMAC-SHA256` over `userId.issuedAt`, secret in
  `.env`, regenerated if absent). `HttpOnly`, `SameSite=Lax`, 30 days.
- Every `/api/*` route requires a session except `login` and the health path.
- Journeys carry `user_id`; you only ever see your own.

Seeded accounts: `matt` / `kyle`. Passwords are set at seed time from the env
or fall back to the agreed demo values. **This is demo-grade auth**: no reset
flow, no rate limiting beyond a simple per-IP delay, no email. It exists to
separate two profiles, not to defend a bank.

## What we deliberately did not build

- **Per-step apps chosen by the system.** The agent still decides; the profile
  only bounds it. Deciding centrally would flatten the thing that makes this
  work.
- **A settings screen.** The profile is visible and adjustable in the app, but
  the primary mechanism is behavioural. A person should not have to configure
  their way to a good experience.
- **Cross-user learning.** Two users, no pooling. Nothing here generalises
  from one person to another yet, and pretending otherwise would be dishonest
  about the sample size.


## Update — the settings surface

The baseline stays deliberately short (five questions, once). Everything else
lives in the settings sheet behind the avatar, because "customise everything"
and "ask everything up front" are opposite goals: the baseline exists to get a
*usable* starting point in under a minute, and the sheet exists to let someone
who cares change any of it afterwards.

What is settable, and how each one is honoured:

| Setting | Stored as | How it takes effect |
|---|---|---|
| Windows at once | `stated.parallelism` | **Enforced** — `maxApps` budget in `makeExecutors` |
| Wait for me | `stated.checkins` | Prompt (`brief`) + the "I'm ready" control |
| Chameleon speaks | `stated.voice` | Prompt — narrate vs the chat reply |
| Chat replies | `stated.chatter` | Prompt |
| Detail | `stated.depth` | Prompt |
| Diagrams & pictures | `stated.visuals` | Prompt |
| Assume I know | `stated.priorKnowledge` | Prompt |
| What it can build | `stated.apps` | **Enforced** — `allowedApps`, checked before any artifact is written |

The two that are enforced are the two where a model talking itself round would
be most visible to the learner: opening a second window when they asked for one,
and building a podcast when they switched podcasts off.

`voice` was measured end to end rather than assumed: the same request with
`voice: 'windows'` produced 443 characters of chat and 315 of narration; with
`voice: 'chat'` it produced 1396 and 139.

### A note on the panel

It is a full-height sheet at body level, not a popover in the topbar, for two
reasons. The topbar sets `backdrop-filter`, which makes it a containing block —
a `position: fixed` child gets clipped to the bar's height. And clicks inside it
must call `stopPropagation`: changing a setting repaints the sheet, which
detaches the clicked node, so a document-level "was this click outside?" check
sees an orphan and closes the panel you are using.


## Update — two homes for the spine, and coaching

Matt's feedback after using it: *"I feel like we should put the plan in the chat
experience instead of having its own plan window. This would allow the user to
talk to the agent about the plan, and tell the agent via chat when they are
ready for the next thing."* Kyle's, the same morning: *"I do actually have like
6 apps up at once… it jumping around like that is super satisfying to me — but
that comes back to the concept of having it learn its user, because it shouldn't
do that for everyone."*

Both are right, for themselves. So `planPlace` joins `parallelism` as a
per-learner property rather than a product decision:

- `planPlace: 'chat'` — no plan tile exists. `#chat-plan` renders the spine at
  the top of the chat surface: a folded step list you can open and click, the
  current step with its `done_when`, and Ready / I'm stuck by the composer.
  `update_plan` opens no window and `layout {open: plan}` is refused.
- `planPlace: 'window'` — the `plan` tile, as before, exempt from the app budget.

Both render from one `STEP` object in `apps.js` (advance / stuck / jump), so the
two homes cannot drift apart in what they tell the agent.

### Coaching

The settings sheet is not the only way in. `remember_preference` lets the agent
record a durable preference the moment it is said, writing to the same `stated`
object. Measured live, starting from four-windows/never-check-in/plan-in-a-window:

| Said in chat | Became |
|---|---|
| "Stop opening more than one thing at a time" | `parallelism: 1` |
| "Put the plan in the chat rather than its own window, and check with me before each step" | `planPlace: 'chat'`, `checkins: 'every-step'` |
| "I never want podcasts, ever" | `apps.podcast: false` |

All three took effect in the UI immediately, survived a reload, and appeared
pre-selected in the settings sheet.

### Why the baseline stopped asking about prior knowledge

It asked "how much background do you bring?" as a global. That is close to
meaningless — the same person is deep in one area and blank in the next, and a
system that pins them to "expert" then skips fundamentals in a new field is
worse than one that never asked. It survives as a default in the sheet, and the
brief now says plainly to override it from evidence.


## Update — one control, and the agent as a layer

Two rounds of Matt using it produced the same note twice, so it is worth
stating as a principle: **tracking everything and exposing everything are
different decisions, and we had been treating them as one.**

> "I love the fact that we've got those [settings]. I don't love the fact that
> we expose them to users… I felt like there should be just a slider — how
> crazy do you want to go. And all of the parameters hang off just one."

So `MODES` in `server/profile.js` is a named bundle of every tuned parameter,
and `modeOf()` derives which one a profile currently matches (or `custom`).
The settings sheet leads with three cards; the parameters are behind
**Advanced**. The observed layer, the signals and the coaching are all
unchanged — they were never the problem.

Onboarding collapsed from five questions to one for the same reason. The other
four were asking a stranger to predict preferences they have no basis to
predict yet, when the system can watch instead.

### The agent is not an app

Matt, on why the workspace confused him:

> "I get confused when the agent is part of the apps. I don't get confused if
> the agent says, let me change that podcast for you, and goes and edits one of
> the apps… I think I have a problem when the agent is part of the app."

The fix is visual, not architectural. Docked to a side the chat surface drops
its card, border and shadow and becomes a layer — the conversation occupies its
column, only the composer is drawn, and the apps are the only things in boxes.
Agent replies lost their chat bubbles for the same reason: a bubble is a *thing
on the page*, competing with the things on the page. The learner's own messages
kept theirs, because their turn genuinely is a discrete event.

Left is the default because Matt asked for "a familiar place where I know where
to go for the agent". The centre dock still exists and still floats; it is now
a choice rather than the default.

### Not built, deliberately

Two threads from the same conversations are strategy rather than code, and are
recorded here so they are not silently forgotten:

- **Verticalised packaging.** Selling the same general platform with
  pre-packaged use-case bundles per industry, rather than verticalised
  products. Nothing in the architecture prevents it — the education tuning
  lives in the prompt and the app registry, which is where a pack would go.
- **Who this is for.** Matt's read is SMB / mid-market, non-technical, possibly
  people who have never used ChatGPT. That is the argument behind `simple`
  being a real mode rather than a courtesy, and behind familiarity beating
  novelty in the first release. It has not been settled.


## Update — answer or plan

> "The agent should behave a bit more like a normal AI system does, in that I
> just send a prompt like 'write me an email' or I paste some content and say
> 'summarise this for me' and the agent will be able to just one-shot the
> answer. The point being it doesn't need to make a plan for every question I
> ask… there should be some kind of very quick decision upfront as to whether
> or not we need to apply a plan to a request versus just respond to the
> question. Then this would be something I would genuinely use for everything."

The system prompt now opens with that decision, before anything else:

- **Answer** — most requests. Write it properly, in chat, and stop. No plan, no
  checklist, no windows unless the answer is something they will keep.
- **Plan** — work with several sittings in it. The test: can you name three
  steps that each end in something they could show you? If not, it is an
  answer.
- **When in doubt, answer.** A plan nobody asked for is the most irritating
  thing you can do to a small request. Offering one afterwards in a line costs
  nothing.

Two existing principles had to be qualified rather than kept absolute: "the app
window is your voice, not the chat" and "your chat reply is the least important
thing you write" are true *while teaching* and exactly wrong when answering,
where the reply IS the deliverable.

Measured live, 5/5 in `simple` and 5/5 in `extreme`: three small asks answered
in chat with no plan and no windows, two pieces of work planned. Pinned in
`test/persona-triage.test.js` (behind `PERSONA=1`).

The entry point moved with it — "What do you want to do today?" rather than
"What do you want to learn?", with suggestions that are deliberately half
one-shot asks and half pieces of work. Learning is the first use case, not the
boundary of the product.
