/**
 * Phase 1: Local development harness.
 *
 * Runs Doom via WASM in a Worker thread, streams PNG frames to a browser
 * over WebSocket, and receives key inputs back. No AT Protocol involved.
 *
 * Usage:
 *   WAD_PATH=./doom1.wad pnpm --filter @singi-labs/doom-server dev:local
 *
 * Then open http://localhost:8666 in a browser.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { WebSocketServer, WebSocket } from 'ws'
import { DOOM_KEYS } from './wasm/doom-engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env['DEBUG_PORT'] ?? '8666', 10)
const WAD_PATH = process.env['WAD_PATH'] ?? 'doom1.wad'
const TARGET_FPS = parseInt(process.env['TARGET_FPS'] ?? '15', 10)

/** Map browser KeyboardEvent.code to Doom key codes */
function browserKeyToDoom(code: string): number | null {
  const map: Record<string, number> = {
    ArrowUp: DOOM_KEYS.UPARROW,
    ArrowDown: DOOM_KEYS.DOWNARROW,
    ArrowLeft: DOOM_KEYS.LEFTARROW,
    ArrowRight: DOOM_KEYS.RIGHTARROW,
    ControlLeft: DOOM_KEYS.FIRE,
    ControlRight: DOOM_KEYS.FIRE,
    Space: DOOM_KEYS.USE,
    ShiftLeft: DOOM_KEYS.RSHIFT,
    ShiftRight: DOOM_KEYS.RSHIFT,
    AltLeft: DOOM_KEYS.RALT,
    AltRight: DOOM_KEYS.RALT,
    Enter: DOOM_KEYS.ENTER,
    Escape: DOOM_KEYS.ESCAPE,
    Tab: DOOM_KEYS.TAB,
    Equal: DOOM_KEYS.EQUALS,
    Minus: DOOM_KEYS.MINUS,
    F1: DOOM_KEYS.F1,
    F2: DOOM_KEYS.F2,
    F3: DOOM_KEYS.F3,
    F4: DOOM_KEYS.F4,
    F5: DOOM_KEYS.F5,
    F6: DOOM_KEYS.F6,
    F7: DOOM_KEYS.F7,
    F8: DOOM_KEYS.F8,
    F9: DOOM_KEYS.F9,
    F10: DOOM_KEYS.F10,
    F11: DOOM_KEYS.F11,
    Pause: DOOM_KEYS.PAUSE,
  }
  if (code in map) return map[code]!
  if (code.startsWith('Key')) return code.charCodeAt(3) + 32
  if (code.startsWith('Digit')) return code.charCodeAt(5)
  return null
}

async function main() {
  console.log('Doom AT Protocol -- Local Harness')
  console.log(`  WAD: ${WAD_PATH}`)
  console.log(`  Port: ${PORT}`)
  console.log(`  FPS: ${TARGET_FPS}`)
  console.log()

  // Serve the HTML page
  const clientHtml = await readFile(
    join(__dirname, '..', '..', 'client', 'public', 'index.html'),
    'utf-8',
  )

  const injectedHtml = clientHtml.replace(
    '</script>',
    `
    const ws = new WebSocket('ws://' + location.host + '/ws')
    ws.binaryType = 'arraybuffer'

    ws.onopen = () => {
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, 320, 200)
      ctx.fillStyle = '#4ade80'
      ctx.fillText('Connected! Loading...', 160, 100)
    }

    let frameCount = 0
    let lastFpsTime = performance.now()

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const blob = new Blob([event.data], { type: 'image/png' })
        const url = URL.createObjectURL(blob)
        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0)
          URL.revokeObjectURL(url)
          frameCount++
          const now = performance.now()
          if (now - lastFpsTime >= 1000) {
            document.getElementById('fps').textContent = frameCount
            frameCount = 0
            lastFpsTime = now
          }
        }
        img.src = url
      } else {
        const data = JSON.parse(event.data)
        if (data.tick !== undefined) {
          document.getElementById('tick').textContent = data.tick
        }
        if (data.latency !== undefined) {
          document.getElementById('latency').textContent = data.latency
        }
      }
    }

    document.addEventListener('keydown', (e) => {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'key', code: e.code, pressed: true }))
    })
    document.addEventListener('keyup', (e) => {
      e.preventDefault()
      ws.send(JSON.stringify({ type: 'key', code: e.code, pressed: false }))
    })
    </script>`,
  )

  // HTTP + WebSocket server
  const httpServer = createServer((req, res) => {
    if (req.url === '/ws') return
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(injectedHtml)
  })
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const clients = new Set<WebSocket>()

  // Start Doom engine in a Worker thread
  const workerPath = join(__dirname, 'wasm', 'doom-worker.ts')
  const worker = new Worker(workerPath, {
    execArgv: ['--import', 'tsx'],
  })

  // Wait for engine to be ready
  const ready = new Promise<{ width: number; height: number }>((resolve, reject) => {
    const onMessage = (msg: { type: string; width?: number; height?: number; message?: string }) => {
      if (msg.type === 'ready') {
        worker.off('message', onMessage)
        resolve({ width: msg.width!, height: msg.height! })
      } else if (msg.type === 'error') {
        worker.off('message', onMessage)
        reject(new Error(msg.message))
      }
    }
    worker.on('message', onMessage)
  })

  console.log('Loading Doom engine in worker thread...')
  worker.postMessage({ type: 'init', wadPath: WAD_PATH })
  const { width, height } = await ready
  console.log(`Doom initialized! Screen: ${width}x${height}`)
  console.log()

  // Handle frames from worker
  let tickTimer: ReturnType<typeof setInterval> | null = null
  let framesSent = 0
  let waitingForFrame = false

  worker.on('message', (msg: { type: string; png?: Buffer; tick?: number; elapsed?: number; message?: string }) => {
    console.log(`[main] worker msg: ${msg.type}${msg.type === 'frame' ? ` (${msg.png?.length ?? '?'}b)` : ''}`)
    if (msg.type === 'frame') {
      waitingForFrame = false

      if (framesSent === 0) {
        console.log(`First frame: ${msg.png!.length} bytes, tick ${msg.tick}, ${msg.elapsed}ms`)
      }

      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg.png!)
          client.send(JSON.stringify({ tick: msg.tick, latency: msg.elapsed }))
        }
      }
      framesSent++
      if (framesSent % 100 === 0) {
        console.log(`Frames: ${framesSent}, PNG: ${msg.png!.length}b, ${msg.elapsed}ms/frame`)
      }
    } else if (msg.type === 'error') {
      console.error('Worker error:', msg.message)
    }
  })

  function startTicking() {
    if (tickTimer) return
    console.log(`Starting game loop at ${TARGET_FPS} fps`)
    framesSent = 0
    waitingForFrame = false
    let ticksSent = 0
    tickTimer = setInterval(() => {
      if (waitingForFrame) return
      waitingForFrame = true
      ticksSent++
      if (ticksSent <= 3) console.log(`[main] sending tick #${ticksSent}`)
      worker.postMessage({ type: 'tick' })
    }, 1000 / TARGET_FPS)
  }

  function stopTicking() {
    if (tickTimer && clients.size === 0) {
      clearInterval(tickTimer)
      tickTimer = null
      console.log('Game loop paused (no clients)')
    }
  }

  wss.on('connection', (ws) => {
    console.log('Client connected')
    clients.add(ws)
    startTicking()

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'key') {
        const doomKey = browserKeyToDoom(msg.code as string)
        if (doomKey !== null) {
          worker.postMessage({ type: 'key', pressed: msg.pressed, key: doomKey })
        }
      }
    })

    ws.on('close', () => {
      console.log('Client disconnected')
      clients.delete(ws)
      stopTicking()
    })
  })

  httpServer.listen(PORT, () => {
    console.log(`Open http://localhost:${PORT} in your browser`)
    console.log('Press Ctrl+C to stop')
  })
}

main().catch(console.error)
