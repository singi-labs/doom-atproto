# Doom over AT Protocol

Can the AT Protocol run Doom? Let's find out.

Inspired by [Doom over DNS](https://blog.rice.is/post/doom-over-dns/), this project runs Doom with full AT Protocol federation. Every player input and every rendered frame passes through the protocol -- no shortcuts.

## How It Works

```
Player (browser)                    Game Server (Node.js)
  Keyboard input                      Jetstream subscriber
  -> writes dev.singi.doom.input      <- reads player input records
     to player's PDS                  -> runs Doom engine tick (WASM)
                                      -> encodes frame as PNG
  Canvas renderer                     -> writes dev.singi.doom.frame
  <- subscribes via Jetstream            to server's PDS
     to dev.singi.doom.frame
```

Both player and server have AT Protocol accounts. The game server runs a dedicated bot account.

The game engine (doomgeneric) is compiled to WASM and driven tick-by-tick. Each tick's input arrives as an AT Protocol record, and each rendered frame is written back as a PNG blob in a record.

**Expected framerate: 1-5 fps.** That's the point.

## Two Modes

### Federated Mode (the cursed one)

Every game tick goes through the AT Protocol network. Input -> PDS -> Jetstream -> server -> Doom tick -> PNG encode -> PDS -> Jetstream -> client -> render. Full round-trip through federated infrastructure per frame.

### Storage Mode (the DNS analog)

Store the entire WAD and game engine as chunked blobs on a PDS using `dev.singi.doom.artifact` records. A loader fetches all chunks, reassembles in memory, runs locally. The direct equivalent of Doom-over-DNS, but with ~5 blob records instead of ~2,000 DNS TXT records.

## Setup

```bash
# Clone and install
git clone https://github.com/singi-labs/doom-atproto.git
cd doom-atproto
pnpm install

# You'll need:
# 1. DOOM1.WAD (shareware) in the project root
# 2. Two AT Protocol accounts (player + server bot)
# 3. App passwords for both

# Copy and fill in environment variables
cp .env.example .env

# Build
pnpm build
```

## Status

This is an experimental project. See [AGENTS.md](./AGENTS.md) for technical details.

**Phase 1** (current): WASM proof-of-concept -- getting doomgeneric running tick-by-tick in Node.js.

## Lexicons

| NSID | Purpose |
|------|---------|
| `dev.singi.doom.defs` | Shared types (key bitmask, frame metadata) |
| `dev.singi.doom.session` | Game session record |
| `dev.singi.doom.input` | Player input per tick batch |
| `dev.singi.doom.frame` | Rendered frame per tick batch |
| `dev.singi.doom.artifact` | Game asset storage (WAD/engine chunks) |

## License

MIT
