<p align="center">
  <img src="public/chameleon.png" width="110" alt="Chameleon">
</p>

<h1 align="center">Chameleon</h1>
<p align="center"><em>An adaptive AI sales workspace — the UI reshapes itself around the conversation.</em></p>

---

Chameleon is a demo of a **collaborative AI canvas**: you talk to an agent (or click anything on screen) and it opens, resizes, rearranges and closes tools live on a grid — while you retain full manual control with drag-anywhere, free-form resize, and dockable chat. Built for an enterprise-seller narrative (5 simulated accounts, 9 live deals, a competitive fight vs "Hyperion Cloud"), but the layout engine and interaction system are the point.

## Highlights

- **Adaptive grid engine** — spring-morphing tiles on an 8×6 canvas; solver with exact user-pins, neighbor bending, ghost-then-tuck displacement, and auto-fill for AI layouts only
- **Total manual control** — drag any tile from anywhere (top-half = move, bottom-half/corner = resize both axes, edges = one axis), per-cell free-form sizing, min guides + live `W×H` readout, limit shakes with sonar waves; AI reshapes announce themselves with hue-tinted rings
- **Morphing chat** — floats (movable, self-sizing), docks left/right, becomes a ChatGPT-style bottom composer (transcript pops out as its own draggable tile), or minimizes to a sliver — all via drag with dashed drop-zones
- **~430 precomputed routes** — clicks and common intents resolve in ~20 ms with cinematic playback; everything else streams from Claude with **actions executed as they arrive** (workspace starts moving ~1–2 s in) + prompt caching
- **14 interlocking apps** — presentation, podcast, flashcards, relationship map, petri-dish territory (zoomable), account plan (health ring, engagement chart, touch timeline), pipeline, IBM-grade pricing configurator (metric sizing, term/support tiers, discount stack → TCV), strategy map (goals→initiatives→deals), battlecard, call prep, call review, opportunity card, conversation-as-tile — every data point clickable, apps open apps
- **Grounded CRM** (`crm.js`) — the model treats it as ground truth; context (account/opportunity) propagates everywhere; markdown-rendered verbose replies

## Run it

```bash
# Node 18+ (built-in fetch). Zero npm dependencies.
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env
node server.js
# → http://localhost:8787
```

| Env var | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required (`.env` or environment) |
| `CHAMELEON_MODEL` | `claude-sonnet-4-5` | any Anthropic model id |
| `PORT` | `8787` | |

## Deploying under a sub-path (e.g. `example.com/cmln`)

All asset and API calls are **relative**, so reverse-proxy a prefix straight to the app:

```nginx
location = /cmln { return 301 /cmln/; }          # trailing slash matters
location /cmln/ {
    proxy_pass http://127.0.0.1:8787/;           # note trailing slash = strip prefix
    proxy_http_version 1.1;
    proxy_buffering off;                          # required: /api/chat streams SSE
    proxy_read_timeout 300s;
}
```

## Layout

```
server.js    zero-dep HTTP server · SSE relay to Anthropic · route short-circuit
crm.js       the simulated book of business (ground truth)
routes.js    ~430 precomputed instant responses + free-text intent matcher
public/
  layout.js  grid solver (exact pass, pinning, bend/tuck, growth)
  apps.js    all app renderers + registry + CRM resolvers
  app.js     orchestrator: tiles, drag/resize physics, chat modes, streaming client
  style.css  the whole design system
test/        solver invariants (node test/solver.test.js)
```

## Feel of it

Ask *"which account needs my attention today?"* → a war room assembles in ~1 s. Click the detractor on the relationship map → her dossier pops with counter-moves. Drag the discount past 20% → the deal desk intervenes. Drag the chat to the bottom → it becomes a composer and the transcript becomes a tile. Then move everything wherever you want — it stays.
