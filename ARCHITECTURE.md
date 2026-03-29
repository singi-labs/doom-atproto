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
    -> uploadBlob + createRecord -> Server's PDS (self-hosted)
    -> Jetstream event -> Client server
    -> getBlob -> PNG data
    -> WebSocket -> Browser (canvas)
```

Every keystroke the player presses becomes an AT Protocol record on their PDS. The game server reads those records via Jetstream (a real-time event stream from the AT Protocol relay network), feeds them into a Doom engine compiled to WebAssembly, renders the frame, encodes it as a PNG, and writes it as a blob-backed record to its own PDS. The player's browser reads those frame records (again via Jetstream) and renders them to a canvas.

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

Key state changes (not every keypress) are batched and written to the player's PDS as `dev.singi.doom.input` records every 500ms. This keeps the write rate at ~2 records/sec on the player's PDS.

The game server subscribes to the player's input records via Jetstream, diffs each bitmask against the previous state to generate press/release events, and feeds them to the Doom engine.

## Authentication

Players authenticate via AT Protocol OAuth with granular scopes. The consent screen only asks for permission to write `dev.singi.doom.input` records -- no access to posts, profile, or DMs. If a PDS doesn't support granular scopes, the client falls back to `transition:generic`.

The game server uses an app password on a self-hosted PDS (no OAuth needed for server-to-PDS writes on localhost).

## Self-Hosted PDS

Early versions wrote frames to `bsky.social`, which has rate limits: 5,000 write points per hour, with each record creation costing 3 points. At even 2 fps, the hourly limit is reached in ~14 minutes. We also encountered undocumented anti-abuse throttling that kicked in after rapid-fire record creation.

The solution: a self-hosted AT Protocol PDS running on the same server as the game engine. Frame writes go to `localhost:3000` with near-zero latency and no rate limits. The PDS federates with the AT Protocol network, so Jetstream still delivers events to the client.

This is arguably the architecturally correct setup anyway -- the game server is the authority on frame data, so it should host that data on its own PDS.

## Jetstream vs Polling

The first implementation used `listRecords` polling every 200ms. This caused problems:

- Record ordering assumptions were wrong (TIDs sort differently than expected)
- Polling burns API calls even when nothing changed
- 200ms minimum latency floor

Switching to Jetstream (the AT Protocol's real-time event firehose) solved all three. Events arrive as WebSocket messages within ~50-200ms of record creation. The server subscribes filtered by the player's DID and collection; the client subscribes filtered by the server's DID.

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
| Jetstream propagation | ~50-200ms |
| Full round-trip (input -> frame) | ~200-500ms |
| Visible FPS | 5-10 |
| Game ticks per visible frame | 2-3 |
| Effective game speed | ~20 ticks/sec (57% of native 35) |

## What We Learned

**AT Protocol is not designed for real-time streaming.** It's a document store with an event bus. Using it as a game transport is deliberate misuse -- like Doom over DNS. But unlike DNS, AT Protocol has proper binary blob support, structured schemas, authenticated writes, and a real-time event delivery system (Jetstream). It's a surprisingly capable transport for non-real-time applications.

**Rate limits are the real boss.** The hardest part wasn't the WASM engine or the protocol integration -- it was staying within bsky.social's rate limits. Self-hosting the PDS was the breakthrough that made the project viable.

**Jetstream is underappreciated.** The AT Protocol community mostly talks about the firehose for feed generation. But Jetstream is a general-purpose real-time event system that works for any application built on AT Protocol records. It's what makes this game playable rather than a slideshow.

**The AT Protocol is more flexible than people think.** Custom lexicons, blob storage, OAuth with granular scopes, federation -- the building blocks for applications far beyond social media are already in place.

## Stack

- **Game engine**: doomgeneric -> Emscripten -> WebAssembly (320x200, 456KB)
- **Runtime**: Node.js 22, TypeScript, pnpm monorepo
- **AT Protocol**: @atproto/api, @atproto/oauth-client-node, Jetstream
- **PDS**: Official Bluesky PDS (self-hosted, Docker)
- **Deployment**: Hetzner VPS, Caddy, Docker Compose
- **Source**: [github.com/singi-labs/doom-atproto](https://github.com/singi-labs/doom-atproto)

## Built by

[Singi Labs](https://singi.dev) -- open source foundations for networked apps.
