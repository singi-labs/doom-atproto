# Doom over AT Protocol: Architecture and Technical Choices

## The Premise

Inspired by [Doom over DNS](https://blog.rice.is/post/doom-over-dns/) -- where Adam Rice stored and ran Doom entirely from DNS TXT records -- we asked: can the AT Protocol run Doom? Not just store it, but actually play it, with every player input and every rendered frame traveling through the protocol.

The answer is yes. It's playable at [doom.singi.dev](https://doom.singi.dev).

## How It Works

The data flow is fully federated. No shortcuts.

```
Browser (keyboard)
    -> WebSocket -> Client server
    -> createRecord -> Player's PDS (bsky.social)
    -> Jetstream event -> Game server
    -> Doom WASM engine (tick)
    -> PNG encode
    -> uploadBlob + createRecord -> Server's PDS (localhost, self-hosted)
    -> listRecords poll -> Client server (localhost)
    -> getBlob -> PNG data
    -> WebSocket -> Browser (canvas)
```

Every keystroke the player presses becomes an AT Protocol record on their PDS. The game server reads those records via Jetstream (a real-time event stream from the AT Protocol relay network), feeds them into a Doom engine compiled to WebAssembly, renders the frame, encodes it as a PNG, and writes it as a blob-backed record to its own self-hosted PDS. The player's browser reads those frame records by polling the local PDS and renders them to a canvas.

### Why Not Jetstream for Frames Too?

The input path (player -> server) uses Jetstream because the player's PDS is on bsky.social, which is already indexed by the relay network. The frame path (server -> client) polls the local PDS directly because:

1. A newly self-hosted PDS needs to be crawled by the relay before Jetstream sees its events -- this can take minutes or fail silently
2. Both the game server and client run on the same machine as the PDS, so localhost polling has near-zero latency
3. Polling at 100ms on localhost is faster than waiting for relay propagation (~50-200ms)

This is a pragmatic hybrid: Jetstream where it's the only option (cross-PDS input delivery), direct PDS access where it's faster (same-machine frame delivery).

## The Game Engine

We use [doomgeneric](https://github.com/ozkl/doomgeneric), a portable C implementation of the Doom engine designed for "bring your own I/O." It exposes six callbacks that the platform must implement:

- `DG_Init()` -- no-op (no display to initialize)
- `DG_DrawFrame()` -- framebuffer is read directly from WASM memory
- `DG_SleepMs()` -- no-op (we control timing externally)
- `DG_GetTicksMs()` -- returns real wall-clock time via `emscripten_get_now()`
- `DG_GetKey()` -- reads from a key queue populated before each tick
- `DG_SetWindowTitle()` -- no-op

Compiled to WebAssembly via Emscripten at 320x200 resolution, the engine produces a 456KB `.wasm` file. It runs in a Node.js Worker thread to avoid blocking the HTTP server's event loop.

### Why a Worker Thread

The WASM `doom_tick()` call is synchronous and takes 2-20ms depending on the scene. At the frame rates we target, this would block Node.js's event loop enough to starve HTTP request handling. Running the engine in a Worker thread keeps the main thread responsive for WebSocket connections, OAuth callbacks, and frame delivery.

### Why Real-Time Clock

We tried a controlled clock (incrementing only when `doom_tick()` is called) to prevent Doom's demo autoplay during idle periods. This caused the engine to hang -- `TryRunTics()` inside `doomgeneric_Tick()` polls `DG_GetTicksMs()` in a loop and needs to see time advance during the call. Using `emscripten_get_now()` (real wall-clock time) is the only approach that keeps the engine's internal timing loop functional.

To prevent the demo autoplay that real-time causes, the server sends an Enter key on the first tick to skip the title screen directly to the menu.

### Key Event Queuing

Key events from Jetstream arrive asynchronously while the engine may be mid-tick. Sending `worker.postMessage({ type: 'key' })` during an active `doom_tick()` caused WASM memory corruption ("memory access out of bounds"). The fix: queue key events in the main thread and flush them to the worker only between tick batches.

### Frame Encoding

Doom renders with a 256-color palette, which is ideal for indexed-color PNG. We wrote a minimal PNG encoder that:

1. Scans the RGBA framebuffer for unique colors (always under 256 for Doom)
2. Builds a palette
3. Writes palette-indexed scanlines
4. Compresses with zlib deflate (level 6)

Result: 8-37KB per frame (vs 91KB with standard RGB PNG). Encoding takes ~5ms. The frames fit comfortably within AT Protocol blob size limits.

## Player Input

The browser captures keyboard events and encodes them as a bitmask:

```
bit 0: forward    bit 4: fire      bit 8-15: weapon select
bit 1: backward   bit 5: use       bit 16: escape
bit 2: left       bit 6: strafe    bit 17: enter
bit 3: right      bit 7: speed     bit 18: tab
```

Only key state *changes* are sent (not every periodic tick). These are batched and written to the player's PDS as `dev.singi.doom.input` records every 500ms. This keeps the write rate at ~2 records/sec on the player's PDS.

The game server subscribes to the player's input records via Jetstream, diffs each bitmask against the previous state to generate press/release events, and queues them for the next tick batch.

### Stale Event Filtering

Jetstream replays events from its buffer on reconnection. Without filtering, old input records from previous sessions would be replayed, navigating through menus and starting games automatically. Both the server (inputs) and client (frames) skip any Jetstream event with a `createdAt` timestamp older than 10 seconds.

## Authentication

Players authenticate via AT Protocol OAuth with granular scopes. The consent screen only asks for permission to write `dev.singi.doom.input` records -- no access to posts, profile, or DMs. If a PDS doesn't support granular scopes, the client falls back to `transition:generic`.

The OAuth keypair is persisted to disk so it survives container restarts. Without persistence, each restart generates a new key, but the player's PDS caches the old JWKS -- causing "invalid_client" errors until the cache expires.

The game server uses an app password on a self-hosted PDS (no OAuth needed for server-to-PDS writes on localhost).

## Self-Hosted PDS

Early versions wrote frames to `bsky.social`, which has rate limits: 5,000 write points per hour, with each record creation costing 3 points. At even 2 fps, the hourly limit is reached in ~14 minutes. We also encountered undocumented anti-abuse throttling that kicked in after rapid-fire record creation -- one test session wrote 1,664 records in 2 minutes and locked the account for over an hour, beyond the documented rate limit windows.

We tried multiple bot accounts with automatic cycling when one approached its rate limit budget. This worked but was fragile -- and the shared VPS IP (running Barazo and Sifa alongside Doom) appeared to trigger IP-level throttling as well.

The solution: a dedicated Hetzner CX23 VPS running a self-hosted AT Protocol PDS alongside the game engine. Frame writes go to `localhost:3000` with near-zero latency and no rate limits. The PDS federates with the AT Protocol network via `plc.directory` for identity resolution.

This is arguably the architecturally correct setup -- the game server is the authority on frame data, so it should host that data on its own PDS.

## Idle Management

To prevent wasting resources and PDS storage:

- **Server-side idle timeout**: if no input events arrive for 60 seconds, the game loop pauses. It resumes automatically when Jetstream delivers a new input event.
- **Client-side idle timeout**: if no keyboard activity for 60 seconds, the browser shows a "Paused (idle)" overlay and stops writing input records. Click or keypress to resume.
- **Session timer**: a visible timer warns the player at 25 minutes and stops input writes at 30 minutes.
- **Unchanged frame skipping**: identical frames (e.g., static menu screens) are not re-uploaded, saving PDS writes. A heartbeat frame is written every 10th batch to confirm liveness.

## The Lexicons

Five custom lexicons define the game's data schema:

| Lexicon | Purpose |
|---------|---------|
| `dev.singi.doom.defs` | Shared types: key bitmask, frame metadata, encoding tokens |
| `dev.singi.doom.session` | Game session metadata |
| `dev.singi.doom.input` | Player input: array of key bitmasks per record |
| `dev.singi.doom.frame` | Rendered frame: PNG blob per record |
| `dev.singi.doom.artifact` | Game asset storage for "DNS mode" (store WAD on PDS) |

The `artifact` lexicon enables a second mode inspired directly by the DNS project: store the entire Doom WAD and engine as chunked blobs on a PDS, fetch them, and run locally. The AT Protocol equivalent of 2,000 DNS TXT records -- except you only need ~5 blob records.

## Performance

| Metric | Value |
|--------|-------|
| WASM tick time | 2-20ms |
| PNG encode time | ~5ms |
| Frame size | 8-37KB |
| Server PDS write (localhost) | ~5-20ms |
| Localhost frame poll interval | 100ms |
| Jetstream input delivery | ~50-200ms |
| Full round-trip (input -> frame) | ~200-500ms |
| Visible FPS | 5-15 (varies with Jetstream latency) |
| Game ticks per write batch | 5 |
| Write interval | 500ms |

## What We Learned

**AT Protocol is not designed for real-time streaming.** It's a document store with an event bus. Using it as a game transport is deliberate misuse -- like Doom over DNS. But unlike DNS, AT Protocol has proper binary blob support, structured schemas, authenticated writes, and a real-time event delivery system (Jetstream). It's a surprisingly capable transport for non-real-time applications.

**Rate limits are the real boss.** The hardest part wasn't the WASM engine or the protocol integration -- it was staying within bsky.social's rate limits. The documented limits (5,000 points/hour, 35,000/day) are only part of the story -- there's also undocumented anti-abuse throttling that can lock accounts after burst writes. Self-hosting the PDS was the breakthrough that made the project viable.

**Self-host your PDS if you're building anything non-trivial.** The AT Protocol is designed for federation. Running your own PDS isn't just about avoiding rate limits -- it's about being the authority for your data. The game server produces frame data, so it should host that data on its own PDS. This also eliminates dependency on relay crawling delays.

**Jetstream is underappreciated.** The AT Protocol community mostly talks about the firehose for feed generation. But Jetstream is a general-purpose real-time event system that works for any application built on AT Protocol records. It's what makes this game playable rather than a slideshow.

**WASM engines are surprisingly fragile at high tick rates.** The doomgeneric WASM engine crashes with memory access violations when key events are sent mid-tick or when tick rates exceed what the engine expects. Careful sequencing (queue events, flush before tick, await completion) is essential.

**The AT Protocol is more flexible than people think.** Custom lexicons, blob storage, OAuth with granular scopes, federation, self-hosted PDS -- the building blocks for applications far beyond social media are already in place.

## Infrastructure

```
Hetzner CX23 VPS (188.245.118.132)
├── Caddy (Docker, host networking)
│   ├── doom.singi.dev -> localhost:8667 (game client)
│   └── pds.singi.dev  -> localhost:3000 (AT Protocol PDS)
├── PDS (Docker, official bluesky-social/pds:0.4)
│   └── Account: doom.pds.singi.dev
├── Doom Server (Docker, host networking)
│   ├── WASM engine in Worker thread
│   ├── Jetstream subscription (player inputs)
│   └── Writes frames to localhost PDS
└── Doom Client (Docker, host networking)
    ├── OAuth login flow
    ├── Polls localhost PDS for frames
    └── WebSocket to browser
```

## Stack

- **Game engine**: doomgeneric -> Emscripten -> WebAssembly (320x200, 456KB)
- **Runtime**: Node.js 22, TypeScript, pnpm monorepo
- **AT Protocol**: @atproto/api, @atproto/oauth-client-node, Jetstream
- **PDS**: Official Bluesky PDS 0.4 (self-hosted, Docker)
- **Deployment**: Hetzner CX23 VPS, Caddy, Docker Compose
- **Source**: [github.com/singi-labs/doom-atproto](https://github.com/singi-labs/doom-atproto)

## Built by

[Singi Labs](https://singi.dev) -- open source foundations for networked apps.
