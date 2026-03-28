/**
 * Doom over AT Protocol -- Game Server
 *
 * Reads player input records from their PDS, runs the Doom engine
 * tick-by-tick via WASM, writes rendered frame records to its own PDS.
 *
 * Phase 3: Polling-based. Polls player's PDS for new input records,
 * writes frame records after each tick.
 */
import { Worker } from 'node:worker_threads'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AtpAgent } from '@atproto/api'
import { loadConfig } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface FrameMessage {
  type: 'frame'
  png: Buffer
  tick: number
  elapsed: number
}

async function main() {
  const config = loadConfig()

  console.log('Doom AT Protocol -- Game Server')
  console.log(`  PDS: ${config.ATP_SERVICE}`)
  console.log(`  Bot: ${config.ATP_IDENTIFIER}`)
  console.log(`  WAD: ${config.WAD_PATH}`)
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

  // Track current game state
  let currentPlayerDid: string | null = null
  let lastInputCursor = ''
  let frameSeq = 0
  let waitingForFrame = false

  // Handle frame responses from worker
  worker.on('message', async (msg: FrameMessage | { type: string; message?: string }) => {
    if (msg.type !== 'frame') {
      if (msg.type === 'error') console.error('Worker error:', (msg as { message: string }).message)
      return
    }

    waitingForFrame = false
    const frame = msg as FrameMessage
    frameSeq++

    try {
      // Upload PNG as blob
      const blobResponse = await agent.uploadBlob(frame.png, {
        encoding: 'image/png',
      })

      // Create frame record
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
          meta: {
            width: 320,
            height: 200,
            encoding: 'dev.singi.doom.defs#encodingPng',
          },
          frames: [blobResponse.data.blob],
          createdAt: new Date().toISOString(),
        },
      })

      if (frameSeq % 10 === 0) {
        console.log(`Frame ${frameSeq}: ${frame.png.length}b, ${frame.elapsed}ms tick`)
      }
    } catch (err) {
      console.error('Failed to write frame record:', err instanceof Error ? err.message : err)
    }
  })

  // Poll for input records from the current player
  async function pollInputs() {
    if (!currentPlayerDid) return

    try {
      const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' })
      const response = await publicAgent.com.atproto.repo.listRecords({
        repo: currentPlayerDid,
        collection: LEXICON_IDS.DoomInput,
        limit: 10,
        reverse: true,
      })

      for (const record of response.data.records.reverse()) {
        if (record.uri <= lastInputCursor) continue
        lastInputCursor = record.uri

        const inputData = record.value as { keys: number[] }

        // Feed keys to Doom engine and request a tick
        for (const keyBitmask of inputData.keys) {
          // Convert bitmask to individual key events
          for (let bit = 0; bit < 20; bit++) {
            const pressed = (keyBitmask >> bit) & 1
            if (pressed) {
              const doomKey = bitmaskToDoomKey(bit)
              if (doomKey !== null) {
                worker.postMessage({ type: 'key', pressed: true, key: doomKey })
              }
            }
          }
        }

        // Run a tick and generate a frame
        if (!waitingForFrame) {
          waitingForFrame = true
          worker.postMessage({ type: 'tick' })
        }
      }
    } catch {
      // Player may not have any input records yet
    }
  }

  // Start polling when a player connects
  function startSession(playerDid: string) {
    currentPlayerDid = playerDid
    lastInputCursor = ''
    frameSeq = 0
    console.log(`Game session started for player: ${playerDid}`)

    // Poll every 200ms
    const pollInterval = setInterval(() => {
      pollInputs()
    }, 200)

    // Also run ticks periodically even without input (game needs to advance)
    const tickInterval = setInterval(() => {
      if (!waitingForFrame) {
        waitingForFrame = true
        worker.postMessage({ type: 'tick' })
      }
    }, 1000 / 10) // 10 fps base rate

    return () => {
      clearInterval(pollInterval)
      clearInterval(tickInterval)
      currentPlayerDid = null
      console.log('Game session ended')
    }
  }

  // Simple HTTP endpoint for the client to register a player
  const { createServer } = await import('node:http')
  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    // Start a game session
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

    // Health check
    if (url.pathname === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        status: 'ok',
        serverDid,
        currentPlayer: currentPlayerDid,
        frameSeq,
      }))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  })

  httpServer.listen(config.DEBUG_PORT, () => {
    console.log(`Server API listening on port ${config.DEBUG_PORT}`)
    console.log('Waiting for player to start a session...')
  })
}

/** Map bitmask bit position to doomgeneric key code */
function bitmaskToDoomKey(bit: number): number | null {
  const map: Record<number, number> = {
    0: 0xad,  // forward (UPARROW)
    1: 0xaf,  // backward (DOWNARROW)
    2: 0xac,  // left (LEFTARROW)
    3: 0xae,  // right (RIGHTARROW)
    4: 0xa3,  // fire
    5: 0xa2,  // use
    6: 0x80 + 0x38, // strafe (ALT)
    7: 0x80 + 0x36, // speed (SHIFT)
    8: 0x31,  // weapon 1
    9: 0x32,  // weapon 2
    10: 0x33, // weapon 3
    11: 0x34, // weapon 4
    12: 0x35, // weapon 5
    13: 0x36, // weapon 6
    14: 0x37, // weapon 7
    15: 0x38, // weapon 8
    16: 27,   // escape
    17: 13,   // enter
    18: 9,    // tab
    19: 0xff, // pause
  }
  return map[bit] ?? null
}

main().catch(console.error)
