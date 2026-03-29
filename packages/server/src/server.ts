/**
 * Doom over AT Protocol -- Game Server (Jetstream)
 *
 * Subscribes to Jetstream for player input records,
 * runs Doom ticks, writes frame records to its own PDS.
 * Cycles through multiple bot accounts to stay within rate limits.
 */
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { AtpAgent } from '@atproto/api'
import { loadConfig, parseBotAccounts, type BotAccount } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'
import { createJetstreamClient } from './jetstream.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Self-hosted PDS: no rate limits. Push as fast as PDS + Jetstream can handle.
// PDS write takes ~10ms average. Jetstream propagation ~50-200ms is the real ceiling.
const TICKS_PER_WRITE = 1
const WRITE_INTERVAL_MS = 50 // 20 writes/sec, 1:1 tick-to-frame
const IDLE_TIMEOUT_MS = 60_000 // 1 minute
// Point budget only matters for bsky.social accounts, not self-hosted PDS.
// Keep tracking for monitoring but set high.
const POINTS_BUDGET = 999_999
const POINTS_PER_WRITE = 3

async function main() {
  const config = loadConfig()
  const accounts = parseBotAccounts(config.ATP_ACCOUNTS)

  console.log('Doom AT Protocol -- Game Server (Jetstream)')
  console.log(`  PDS: ${config.ATP_SERVICE}`)
  console.log(`  Bot accounts: ${accounts.map(a => a.identifier).join(', ')}`)
  console.log(`  ${TICKS_PER_WRITE} ticks per write, ${WRITE_INTERVAL_MS}ms interval`)
  console.log()

  // Login all bot accounts upfront
  const agents: Array<{ agent: AtpAgent; did: string; account: BotAccount; pointsUsed: number; pointsResetAt: number }> = []
  for (const account of accounts) {
    const agent = new AtpAgent({ service: config.ATP_SERVICE })
    await agent.login({ identifier: account.identifier, password: account.password })
    const did = agent.session!.did
    agents.push({ agent, did, account, pointsUsed: 0, pointsResetAt: Date.now() + 3600_000 })
    console.log(`  Logged in: ${account.identifier} (${did})`)
  }

  let currentAgentIndex = 0

  function getCurrentAgent() {
    const entry = agents[currentAgentIndex]!
    // Reset points if the hour has passed
    if (Date.now() > entry.pointsResetAt) {
      entry.pointsUsed = 0
      entry.pointsResetAt = Date.now() + 3600_000
    }
    return entry
  }

  function cycleToNextAgent(): boolean {
    const startIndex = currentAgentIndex
    for (let i = 0; i < agents.length; i++) {
      const nextIndex = (startIndex + 1 + i) % agents.length
      const entry = agents[nextIndex]!
      if (Date.now() > entry.pointsResetAt) {
        entry.pointsUsed = 0
        entry.pointsResetAt = Date.now() + 3600_000
      }
      if (entry.pointsUsed < POINTS_BUDGET) {
        currentAgentIndex = nextIndex
        console.log(`Cycled to bot account: ${entry.account.identifier} (${entry.pointsUsed} points used)`)
        return true
      }
    }
    console.error('All bot accounts exhausted! No account has budget remaining.')
    return false
  }

  function getActiveServerDid(): string {
    return agents[currentAgentIndex]!.did
  }

  // Start Doom engine in worker thread
  const workerPath = join(__dirname, 'wasm', 'doom-worker.ts')
  const worker = new Worker(workerPath, { execArgv: ['--import', 'tsx'] })

  const ready = new Promise<void>((resolve, reject) => {
    const onMessage = (msg: { type: string; message?: string }) => {
      if (msg.type === 'ready') { worker.off('message', onMessage); resolve() }
      else if (msg.type === 'error') { worker.off('message', onMessage); reject(new Error(msg.message)) }
    }
    worker.on('message', onMessage)
  })

  console.log('Loading Doom engine...')
  worker.postMessage({ type: 'init', wadPath: config.WAD_PATH })
  await ready
  console.log('Doom engine ready!')

  // Game state
  let currentPlayerDid: string | null = null
  let frameSeq = 0
  let rateLimited = false
  let previousKeyState = 0
  let gameLoopAbort: AbortController | null = null
  let lastInputTime = Date.now()

  // Frame handling
  let lastFramePng: Buffer | null = null
  let pendingFrameResolve: (() => void) | null = null
  let latestPng: Buffer | null = null
  let latestElapsed = 0

  worker.on('message', (msg: { type: string; png?: Buffer; elapsed?: number; message?: string }) => {
    if (msg.type === 'error') console.error('Worker error:', msg.message)
    if (msg.type === 'frame') {
      latestPng = msg.png!
      latestElapsed = msg.elapsed ?? 0
    }
    if (pendingFrameResolve) { pendingFrameResolve(); pendingFrameResolve = null }
  })

  function tickAndWait(): Promise<void> {
    return new Promise((resolve) => {
      pendingFrameResolve = resolve
      worker.postMessage({ type: 'tick' })
    })
  }

  async function tickBatchAndWrite() {
    for (let i = 0; i < TICKS_PER_WRITE; i++) {
      await tickAndWait()
    }

    if (!latestPng) return

    // Skip unchanged frames
    const pngBuf = Buffer.from(latestPng)
    if (lastFramePng && pngBuf.length === lastFramePng.length && pngBuf.equals(lastFramePng)) {
      return
    }

    lastFramePng = pngBuf
    frameSeq++

    const entry = getCurrentAgent()

    // Check budget before writing
    if (entry.pointsUsed >= POINTS_BUDGET) {
      if (!cycleToNextAgent()) {
        rateLimited = true
        return
      }
    }

    const { agent, did: serverDid } = getCurrentAgent()

    try {
      const blobResponse = await agent.uploadBlob(latestPng, { encoding: 'image/png' })
      await agent.com.atproto.repo.createRecord({
        repo: serverDid,
        collection: LEXICON_IDS.DoomFrame,
        record: {
          $type: LEXICON_IDS.DoomFrame,
          session: { uri: `at://${serverDid}/${LEXICON_IDS.DoomSession}/current`, cid: 'placeholder' },
          seq: frameSeq,
          meta: { width: 320, height: 200, encoding: 'dev.singi.doom.defs#encodingPng' },
          frames: [blobResponse.data.blob],
          createdAt: new Date().toISOString(),
        },
      })

      getCurrentAgent().pointsUsed += POINTS_PER_WRITE

      if (frameSeq <= 3 || frameSeq % 10 === 0) {
        const e = getCurrentAgent()
        console.log(`Frame ${frameSeq}: ${latestPng.length}b, ${latestElapsed}ms | ${e.account.identifier} ${e.pointsUsed}/${POINTS_BUDGET} pts`)
      }
      rateLimited = false
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Frame write error (status ${status}): ${message}`)
      if (status === 429) {
        console.error(`Rate limited on ${getCurrentAgent().account.identifier}, cycling...`)
        getCurrentAgent().pointsUsed = POINTS_BUDGET
        if (!cycleToNextAgent()) {
          rateLimited = true
        }
      }
    }
  }

  // Jetstream: subscribe to player input records
  const jetstream = createJetstreamClient({
    collections: [LEXICON_IDS.DoomInput],
    onEvent: (event) => {
      if (event.kind !== 'commit' || event.commit?.operation !== 'create') return
      if (event.did !== currentPlayerDid) return

      lastInputTime = Date.now()

      const record = event.commit.record as { keys?: number[] } | undefined
      if (!record?.keys) return

      for (const keyBitmask of record.keys) {
        const changed = keyBitmask ^ previousKeyState
        if (changed === 0) continue

        for (let bit = 0; bit < 20; bit++) {
          if (!((changed >> bit) & 1)) continue
          const pressed = (keyBitmask >> bit) & 1
          const doomKey = bitmaskToDoomKey(bit)
          if (doomKey !== null) {
            worker.postMessage({ type: 'key', pressed: !!pressed, key: doomKey })
          }
        }
        previousKeyState = keyBitmask
      }
    },
  })

  async function gameLoop(signal: AbortSignal) {
    console.log(`Game loop: ${TICKS_PER_WRITE} ticks/write, ${WRITE_INTERVAL_MS}ms interval, ${IDLE_TIMEOUT_MS / 1000}s idle timeout`)
    lastInputTime = Date.now()

    while (!signal.aborted) {
      // Auto-pause on idle
      if (Date.now() - lastInputTime > IDLE_TIMEOUT_MS) {
        console.log('Idle timeout -- pausing game loop')
        // Wait for input to resume
        while (Date.now() - lastInputTime > IDLE_TIMEOUT_MS && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (signal.aborted) break
        console.log('Input received -- resuming game loop')
      }

      const start = Date.now()
      if (!rateLimited) {
        await tickBatchAndWrite()
      } else {
        // Try to recover: check if any account has budget
        if (cycleToNextAgent()) {
          rateLimited = false
        } else {
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
      const elapsed = Date.now() - start
      const wait = Math.max(50, WRITE_INTERVAL_MS - elapsed)
      await new Promise((r) => setTimeout(r, wait))
    }
    console.log('Game loop stopped')
  }

  function startSession(playerDid: string) {
    if (gameLoopAbort) gameLoopAbort.abort()

    currentPlayerDid = playerDid
    frameSeq = 0
    rateLimited = false
    previousKeyState = 0
    lastFramePng = null
    lastInputTime = Date.now()
    console.log(`Session started for: ${playerDid} (bot: ${getCurrentAgent().account.identifier})`)

    jetstream.setWantedDids([playerDid])

    gameLoopAbort = new AbortController()
    gameLoop(gameLoopAbort.signal)
  }

  function stopSession() {
    if (gameLoopAbort) gameLoopAbort.abort()
    currentPlayerDid = null
    console.log('Session stopped')
  }

  jetstream.connect()

  // HTTP API
  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    if (url.pathname === '/api/start' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) body += chunk
      const { playerDid } = JSON.parse(body)
      if (!playerDid) { res.writeHead(400); res.end('playerDid required'); return }
      startSession(playerDid)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'started', serverDid: getActiveServerDid() }))
      return
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      stopSession()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'stopped' }))
      return
    }

    if (url.pathname === '/api/health') {
      const e = getCurrentAgent()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        serverDid: getActiveServerDid(),
        currentBot: e.account.identifier,
        pointsUsed: e.pointsUsed,
        pointsBudget: POINTS_BUDGET,
        currentPlayer: currentPlayerDid,
        frameSeq,
        rateLimited,
        accounts: agents.map(a => ({
          identifier: a.account.identifier,
          pointsUsed: a.pointsUsed,
          exhausted: a.pointsUsed >= POINTS_BUDGET,
        })),
      }))
      return
    }

    res.writeHead(404); res.end('Not found')
  })

  httpServer.listen(config.DEBUG_PORT, () => {
    console.log(`API on port ${config.DEBUG_PORT}`)
    console.log('Jetstream listening. Waiting for /api/start...')
  })
}

function bitmaskToDoomKey(bit: number): number | null {
  const map: Record<number, number> = {
    0: 0xad, 1: 0xaf, 2: 0xac, 3: 0xae,
    4: 0xa3, 5: 0xa2, 6: 0x80 + 0x38, 7: 0x80 + 0x36,
    8: 0x31, 9: 0x32, 10: 0x33, 11: 0x34,
    12: 0x35, 13: 0x36, 14: 0x37, 15: 0x38,
    16: 27, 17: 13, 18: 9, 19: 0xff,
  }
  return map[bit] ?? null
}

main().catch(console.error)
