# AGENTS.md -- Doom over AT Protocol

## What This Is

Doom running with full AT Protocol federation. Every player input is written as a record to the player's PDS, delivered via Jetstream to the game server, which runs a Doom tick via WASM and writes the rendered frame back as a record. The player client subscribes to frame records and renders them. No shortcuts -- the protocol is the only transport.

Also supports "storage only" mode: store the WAD and engine as blob artifacts on a PDS, fetch and run locally (the AT Protocol equivalent of Doom-over-DNS).

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 24 / TypeScript (ES2024, strict) |
| Package manager | pnpm (workspace monorepo) |
| Game engine | doomgeneric compiled to WASM via Emscripten |
| AT Protocol | @atproto/api, Jetstream (WebSocket subscription) |
| Frame encoding | PNG (320x200, indexed palette, ~3-8KB/frame) |
| Testing | Vitest |

## Repo Structure

```
packages/
  lexicons/   # dev.singi.doom.* lexicon schemas + generated types
  server/     # Game server: reads inputs, runs Doom WASM, writes frames
  client/     # Player client: captures keys, renders frames (browser)
wasm-build/   # Emscripten build scripts for doomgeneric
```

## Build Commands

```bash
pnpm install                    # Install all dependencies
pnpm build                      # Build all packages
pnpm typecheck                  # Type-check all packages
pnpm lint                       # Lint all packages
pnpm test                       # Run all tests

# Per-package
pnpm --filter @singi-labs/doom-lexicons generate   # Regenerate types from lexicon JSON
pnpm --filter @singi-labs/doom-server dev           # Run server in dev mode
pnpm --filter @singi-labs/doom-client dev           # Run client in dev mode
```

## Lexicons

Namespace: `dev.singi.doom.*`

| Lexicon | Purpose |
|---------|---------|
| `dev.singi.doom.defs` | Shared types: key bitmask, frame metadata, encoding tokens |
| `dev.singi.doom.session` | Game session metadata (WAD, player, status, tick rate) |
| `dev.singi.doom.input` | Player input per tick batch (key bitmasks) |
| `dev.singi.doom.frame` | Rendered frame per tick batch (PNG blobs) |
| `dev.singi.doom.artifact` | Game asset storage (chunked blobs for WAD/engine) |

## Code Style

- Strict TypeScript: no `any`, no `@ts-ignore`, no `as` type assertions without justification
- Named exports only
- Conventional commits: `type(scope): description`
- No floats in AT Protocol records (integers only)
- String fields: `maxGraphemes` for user-facing text, `maxLength` at 10:1 ratio
- Record keys: `tid` for collections
- References: always use `com.atproto.repo.strongRef`

## Environment Variables

### Server
| Variable | Description |
|----------|-------------|
| `ATP_SERVICE` | PDS URL (e.g. `https://bsky.social`) |
| `ATP_IDENTIFIER` | Server bot handle or DID |
| `ATP_PASSWORD` | Server bot app password |
| `PLAYER_DID` | Player DID to accept inputs from |
| `WAD_PATH` | Path to DOOM1.WAD (default: `doom1.wad`) |
| `DEBUG_PORT` | Local debug WebSocket port (default: `8666`) |

### Client
| Variable | Description |
|----------|-------------|
| `ATP_SERVICE` | PDS URL |
| `ATP_IDENTIFIER` | Player handle or DID |
| `ATP_PASSWORD` | Player app password |
| `SERVER_DID` | Game server DID to subscribe to |
| `CLIENT_PORT` | Local browser UI port (default: `8667`) |
