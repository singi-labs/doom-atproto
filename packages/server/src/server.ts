/**
 * Doom over AT Protocol -- Game Server (Jetstream)
 *
 * Subscribes to Jetstream for player input records,
 * runs Doom ticks, writes frame records to its own PDS.
 */
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { AtpAgent } from '@atproto/api'
import { loadConfig } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'
import { createJetstreamClient } from './jetstream.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRAMES_PER_SECOND = 2

async function main() {
  const config = loadConfig()

  console.log('Doom AT Protocol -- Game Server (Jetstream)')
  console.log(`  PDS: ${config.ATP_SERVICE}`)
  console.log(`  Bot: ${config.ATP_IDENTIFIER}`)
  console.log(`  Target: ${FRAMES_PER_SECOND} fps`)
  console.log()

  // Login with app password
  const agent = new AtpAgent({ service: config.ATP_SERVICE })
  await agent.login({
    identifier: config.ATP_IDENTIFIER,
    password: config.ATP_PASSWORD,
  })
  const serverDid = agent.session!.did
  console.log(`Logged in as: ${serverDid}`)

  // Start Doom engine in worker thread
  const workerPath = join(__dirname, 'wasm', 'doom-worker.ts')
  const worker = new Worker(workerPath, {
    execArgv: ['--import', 'tsx'],
  })

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
  let gameLoopRunning = false
  let gameLoopAbort: AbortController | null = null

  // Frame handling: write to PDS
  let pendingFrameResolve: (() => void) | null = null

  worker.on('message', async (msg: { type: string; png?: Buffer; tick?: number; elapsed?: number; message?: string }) => {
    if (msg.type === 'error') {
      console.error('Worker error:', msg.message)
      if (pendingFrameResolve) { pendingFrameResolve(); pendingFrameResolve = null }
      return
    }
    if (msg.type !== 'frame') return

    frameSeq++
    const png = msg.png!

    try {
      const blobResponse = await agent.uploadBlob(png, { encoding: 'image/png' })
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
      if (frameSeq <= 3 || frameSeq % 20 === 0) {
        console.log(`Frame ${frameSeq}: ${png.length}b, ${msg.elapsed}ms`)
      }
      rateLimited = false
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('429') || message.includes('Rate')) {
        if (!rateLimited) { console.error('Rate limited! Pausing.'); rateLimited = true }
      } else {
        console.error('Frame write failed:', message)
      }
    }

    if (pendingFrameResolve) { pendingFrameResolve(); pendingFrameResolve = null }
  })

  function tickAndWait(): Promise<void> {
    return new Promise((resolve) => {
      pendingFrameResolve = resolve
      worker.postMessage({ type: 'tick' })
    })
  }

  // Jetstream: subscribe to player input records
  const jetstream = createJetstreamClient({
    collections: [LEXICON_IDS.DoomInput],
    onEvent: (event) => {
      if (event.kind !== 'commit' || event.commit?.operation !== 'create') return
      if (event.did !== currentPlayerDid) return

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

  // Game loop: tick at target FPS
  async function gameLoop(signal: AbortSignal) {
    const interval = 1000 / FRAMES_PER_SECOND
    console.log(`Game loop running at ${FRAMES_PER_SECOND} fps`)

    while (!signal.aborted) {
      const start = Date.now()
      if (!rateLimited) {
        await tickAndWait()
      }
      const elapsed = Date.now() - start
      const wait = Math.max(100, interval - elapsed)
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
    console.log(`Session started for: ${playerDid}`)

    // Update Jetstream to filter for this player
    jetstream.setWantedDids([playerDid])

    gameLoopAbort = new AbortController()
    gameLoopRunning = true
    gameLoop(gameLoopAbort.signal)
  }

  function stopSession() {
    if (gameLoopAbort) gameLoopAbort.abort()
    gameLoopRunning = false
    currentPlayerDid = null
    console.log('Session stopped')
  }

  // Start Jetstream (always listening, filters by player DID)
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
      res.end(JSON.stringify({ status: 'started', serverDid }))
      return
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      stopSession()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'stopped' }))
      return
    }

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', serverDid, currentPlayer: currentPlayerDid, frameSeq, rateLimited, gameLoopRunning }))
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
