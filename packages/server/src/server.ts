/**
 * Doom over AT Protocol -- Game Server
 *
 * Reads player input records from their PDS, runs the Doom engine
 * tick-by-tick via WASM, writes rendered frame records to its own PDS.
 */
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { AtpAgent } from '@atproto/api'
import { loadConfig } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Conservative rate: 2 frames/sec = 2 blob uploads + 2 record creates = 4 API calls/sec
// At 4 calls/sec: 14,400/hour, 345,600/day -- well under 35K limit if we DON'T run 24/7.
// With a player connected for ~30 min: 7,200 calls. Safe.
const FRAMES_PER_SECOND = 2

async function main() {
  const config = loadConfig()

  console.log('Doom AT Protocol -- Game Server')
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
  console.log()

  // Game state
  let currentPlayerDid: string | null = null
  let stopSession: (() => void) | null = null
  let frameSeq = 0
  let rateLimited = false

  // Handle frame responses from worker -- write to PDS
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
          session: {
            uri: `at://${serverDid}/${LEXICON_IDS.DoomSession}/current`,
            cid: 'placeholder',
          },
          seq: frameSeq,
          meta: { width: 320, height: 200, encoding: 'dev.singi.doom.defs#encodingPng' },
          frames: [blobResponse.data.blob],
          createdAt: new Date().toISOString(),
        },
      })

      if (frameSeq <= 3 || frameSeq % 10 === 0) {
        console.log(`Frame ${frameSeq}: ${png.length}b, ${msg.elapsed}ms tick`)
      }
      rateLimited = false
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('429') || message.includes('Rate')) {
        if (!rateLimited) {
          console.error('Rate limited! Pausing frame writes.')
          rateLimited = true
        }
      } else {
        console.error('Failed to write frame:', message)
      }
    }

    if (pendingFrameResolve) { pendingFrameResolve(); pendingFrameResolve = null }
  })

  /** Run one tick and wait for the frame to be written */
  function tickAndWait(): Promise<void> {
    return new Promise((resolve) => {
      pendingFrameResolve = resolve
      worker.postMessage({ type: 'tick' })
    })
  }

  // Track which input records we've already processed
  let lastInputCursor = ''
  const publicAgent = new AtpAgent({ service: 'https://bsky.social' })

  /** Poll player's PDS for new input records, feed keys to engine */
  async function pollAndApplyInputs() {
    if (!currentPlayerDid) return

    try {
      const response = await publicAgent.com.atproto.repo.listRecords({
        repo: currentPlayerDid,
        collection: LEXICON_IDS.DoomInput,
        limit: 10,
        reverse: true,
      })

      // Process newest-first, but apply in chronological order
      const newRecords = response.data.records
        .reverse()
        .filter(r => r.uri > lastInputCursor)

      for (const record of newRecords) {
        lastInputCursor = record.uri
        const inputData = record.value as { keys: number[] }

        for (const keyBitmask of inputData.keys) {
          // Send key-down for pressed keys, key-up for released
          for (let bit = 0; bit < 20; bit++) {
            const pressed = (keyBitmask >> bit) & 1
            const doomKey = bitmaskToDoomKey(bit)
            if (doomKey !== null && pressed) {
              worker.postMessage({ type: 'key', pressed: true, key: doomKey })
            }
          }
        }
      }

      if (newRecords.length > 0 && frameSeq <= 5) {
        console.log(`Applied ${newRecords.length} input records`)
      }
    } catch {
      // Player may not have input records yet
    }
  }

  /** Game loop: poll inputs, tick, write frame */
  async function gameLoop(signal: AbortSignal) {
    const interval = 1000 / FRAMES_PER_SECOND
    console.log(`Game loop running at ${FRAMES_PER_SECOND} fps`)

    while (!signal.aborted) {
      const start = Date.now()

      // Poll for player inputs before ticking
      await pollAndApplyInputs()

      if (!rateLimited) {
        await tickAndWait()
      }

      // Wait remaining time in the interval
      const elapsed = Date.now() - start
      const wait = Math.max(100, interval - elapsed)
      await new Promise((r) => setTimeout(r, wait))
    }

    console.log('Game loop stopped')
  }

  function startSession(playerDid: string) {
    // Stop existing session
    if (stopSession) stopSession()

    currentPlayerDid = playerDid
    frameSeq = 0
    rateLimited = false
    console.log(`Game session started for player: ${playerDid}`)

    const controller = new AbortController()
    gameLoop(controller.signal)

    stopSession = () => {
      controller.abort()
      currentPlayerDid = null
      stopSession = null
      console.log('Game session ended')
    }
  }

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

      if (!playerDid) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'playerDid required' }))
        return
      }

      startSession(playerDid)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'started', serverDid }))
      return
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      if (stopSession) stopSession()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'stopped' }))
      return
    }

    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        serverDid,
        currentPlayer: currentPlayerDid,
        frameSeq,
        rateLimited,
      }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  httpServer.listen(config.DEBUG_PORT, () => {
    console.log(`Server API listening on port ${config.DEBUG_PORT}`)
    console.log('Waiting for player to connect...')
    console.log()
    console.log('NO ticks will run until /api/start is called.')
  })
}

/** Map bitmask bit position to doomgeneric key code */
function bitmaskToDoomKey(bit: number): number | null {
  const map: Record<number, number> = {
    0: 0xad, 1: 0xaf, 2: 0xac, 3: 0xae, // arrows
    4: 0xa3, 5: 0xa2, // fire, use
    6: 0x80 + 0x38, 7: 0x80 + 0x36, // strafe, speed
    8: 0x31, 9: 0x32, 10: 0x33, 11: 0x34, // weapons 1-4
    12: 0x35, 13: 0x36, 14: 0x37, 15: 0x38, // weapons 5-8
    16: 27, 17: 13, 18: 9, 19: 0xff, // escape, enter, tab, pause
  }
  return map[bit] ?? null
}

main().catch(console.error)
