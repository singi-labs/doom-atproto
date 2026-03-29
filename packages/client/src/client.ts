/**
 * Doom over AT Protocol -- Player Client
 *
 * Serves the browser UI, handles OAuth login, writes input records
 * to the player's PDS, reads frame records from the server's PDS.
 *
 * For Phase 3 (polling), the game loop is:
 * 1. Browser sends key events via WebSocket
 * 2. Client writes input records to player's PDS
 * 3. Client polls server's PDS for frame records
 * 4. Client streams PNG frames to browser via WebSocket
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { Agent } from '@atproto/api'
import { createOAuthClient } from './oauth.js'
import { loadConfig } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const config = loadConfig()

  console.log('Doom AT Protocol -- Player Client')
  console.log(`  Public URL: ${config.PUBLIC_URL}`)
  console.log(`  Server DID: ${config.SERVER_DID}`)
  console.log(`  Port: ${config.CLIENT_PORT}`)
  console.log()

  // Initialize OAuth client
  console.log('Initializing OAuth client...')
  const oauthClient = await createOAuthClient({ publicUrl: config.PUBLIC_URL })
  console.log('OAuth client ready')

  // Track player sessions: sessionId -> { did, handle, agent }
  const playerSessions = new Map<string, { did: string; handle: string; agent: Agent }>()

  // Read browser HTML
  const clientHtml = await readFile(
    join(__dirname, '..', 'public', 'index.html'),
    'utf-8',
  )

  // HTTP server
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    try {
      // OAuth client metadata (AT Protocol requires this at the client_id URL)
      if (url.pathname === '/oauth/client-metadata.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(oauthClient.clientMetadata))
        return
      }

      // JWKS endpoint
      if (url.pathname === '/oauth/jwks.json') {
        const jwks = oauthClient.jwks
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(jwks))
        return
      }

      // OAuth login: POST with handle
      if (url.pathname === '/oauth/login' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { handle } = JSON.parse(body)

        if (!handle || typeof handle !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Handle is required' }))
          return
        }

        // Normalize handle: strip leading @, append .bsky.social if no domain
        let normalizedHandle = handle.trim().replace(/^@/, '')
        if (!normalizedHandle.includes('.')) {
          normalizedHandle += '.bsky.social'
        }

        // Try granular scope first (only write input records), fall back if PDS rejects
        try {
          const authUrl = await oauthClient.authorize(normalizedHandle, {
            scope: 'atproto repo:dev.singi.doom.input',
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ redirectUrl: authUrl.toString() }))
        } catch {
          console.log('Granular scope rejected, falling back to transition:generic')
          try {
            const authUrl = await oauthClient.authorize(normalizedHandle, {
              scope: 'atproto transition:generic',
            })
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ redirectUrl: authUrl.toString() }))
          } catch (err) {
            console.error('OAuth authorize failed:', err)
            res.writeHead(502, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Authorization failed' }))
          }
        }
        return
      }

      // OAuth callback
      if (url.pathname === '/oauth/callback') {
        const params = url.searchParams

        if (!params.get('code') || !params.get('state')) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing code or state')
          return
        }

        try {
          const { session } = await oauthClient.callback(params)
          const did = session.did
          const sessionId = crypto.randomUUID()

          // Create an authenticated agent for this player
          const agent = new Agent(session)

          // Resolve handle
          let handle: string = did
          try {
            const publicAgent = new Agent('https://public.api.bsky.app')
            const profile = await publicAgent.getProfile({ actor: did as `did:plc:${string}` })
            handle = profile.data.handle
          } catch {
            console.warn('Could not resolve handle for', did)
          }

          playerSessions.set(sessionId, { did, handle, agent })

          // Notify game server about the new player
          try {
            await fetch(`http://doom-server:${8666}/api/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playerDid: did }),
            })
          } catch (err) {
            console.error('Failed to notify server:', err)
          }

          console.log(`Player authenticated: ${handle} (${did})`)

          // Redirect to game with session cookie
          res.writeHead(302, {
            'Set-Cookie': `doom_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${config.PUBLIC_URL.startsWith('https') ? '; Secure' : ''}`,
            Location: '/',
          })
          res.end()
        } catch (err) {
          console.error('OAuth callback failed:', err)
          res.writeHead(302, { Location: '/?error=auth_failed' })
          res.end()
        }
        return
      }

      // Session info API
      if (url.pathname === '/api/session') {
        const cookie = req.headers.cookie ?? ''
        const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
        const session = sessionId ? playerSessions.get(sessionId) : undefined

        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (session) {
          res.end(JSON.stringify({ authenticated: true, did: session.did, handle: session.handle }))
        } else {
          res.end(JSON.stringify({ authenticated: false }))
        }
        return
      }

      // Logout
      if (url.pathname === '/oauth/logout' && req.method === 'POST') {
        const cookie = req.headers.cookie ?? ''
        const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
        if (sessionId) {
          playerSessions.delete(sessionId)
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'doom_session=; Path=/; Max-Age=0',
        })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }

      // WebSocket upgrade is handled by wss
      if (url.pathname === '/ws') return

      // Serve the game page
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(clientHtml)
    } catch (err) {
      console.error('Request error:', err)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal server error')
    }
  })

  // WebSocket server for browser communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const clients = new Map<WebSocket, { sessionId?: string; did?: string }>()

  // Poll server's PDS for frame records
  const serverAgent = new Agent({ service: 'https://public.api.bsky.app' })
  let lastFrameCursor = ''
  let pollTimer: ReturnType<typeof setInterval> | null = null

  let pollCount = 0

  async function pollFrames() {
    try {
      const response = await serverAgent.com.atproto.repo.listRecords({
        repo: config.SERVER_DID,
        collection: LEXICON_IDS.DoomFrame,
        limit: 5,
        reverse: true, // newest first
      })

      pollCount++
      if (pollCount <= 3) {
        console.log(`Poll ${pollCount}: ${response.data.records.length} records, cursor: ${lastFrameCursor.slice(-20)}`)
      }

      for (const record of response.data.records.reverse()) {
        if (record.uri <= lastFrameCursor) continue
        lastFrameCursor = record.uri

        const frameData = record.value as {
          seq: number
          frames: Array<{ $type: string; ref: { $link: string }; mimeType: string }>
          createdAt: string
        }

        // Download each frame blob
        for (const frame of frameData.frames) {
          try {
            // Blob ref is at frame.ref.$link
            const cid = frame.ref.$link
            if (pollCount <= 3) {
              console.log(`  Fetching blob: ${cid}`)
            }

            const blobResponse = await serverAgent.com.atproto.sync.getBlob({
              did: config.SERVER_DID,
              cid,
            })

            const png = Buffer.from(blobResponse.data as unknown as ArrayBuffer)

            if (pollCount <= 3) {
              console.log(`  Got PNG: ${png.length} bytes`)
            }

            // Send to all connected clients
            for (const [ws] of clients) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(png)
                ws.send(JSON.stringify({
                  tick: frameData.seq,
                  latency: Date.now() - new Date(frameData.createdAt).getTime(),
                }))
              }
            }
          } catch (err) {
            console.error('Failed to fetch frame blob:', err instanceof Error ? err.message : err)
          }
        }
      }
    } catch (err) {
      if (pollCount <= 3) {
        console.error('Poll error:', err instanceof Error ? err.message : err)
      }
    }
  }

  function startPolling() {
    if (pollTimer) return
    console.log('Starting frame polling')
    pollTimer = setInterval(pollFrames, 200) // Poll every 200ms
  }

  function stopPolling() {
    if (pollTimer && clients.size === 0) {
      clearInterval(pollTimer)
      pollTimer = null
      console.log('Stopped frame polling')
    }
  }

  wss.on('connection', (ws, req) => {
    const cookie = req.headers.cookie ?? ''
    const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
    const session = sessionId ? playerSessions.get(sessionId) : undefined

    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }))
      ws.close()
      return
    }

    console.log(`WebSocket connected: ${session.did}`)
    clients.set(ws, { sessionId, did: session.did })
    startPolling()

    // Batch input writes: collect key states, write 1 record per second max
    const playerAgent = session.agent
    const playerDid = session.did
    let pendingKeys: number[] = []
    let inputSeq = 0
    let writeTimer: ReturnType<typeof setInterval> | null = null

    async function flushInputs() {
      if (pendingKeys.length === 0) return
      const keys = pendingKeys.slice()
      pendingKeys = []
      const seq = inputSeq
      inputSeq += keys.length

      try {
        await playerAgent.com.atproto.repo.createRecord({
          repo: playerDid,
          collection: LEXICON_IDS.DoomInput,
          record: {
            $type: LEXICON_IDS.DoomInput,
            session: {
              uri: `at://${config.SERVER_DID}/${LEXICON_IDS.DoomSession}/current`,
              cid: 'placeholder',
            },
            seq,
            keys,
            createdAt: new Date().toISOString(),
          },
        })
      } catch (err) {
        console.error('Failed to write input record:', err instanceof Error ? err.message : err)
      }
    }

    // Flush batched inputs every 500ms (2 writes/sec max)
    writeTimer = setInterval(flushInputs, 500)

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'key') {
        pendingKeys.push(msg.keys ?? 0)
      }
    })

    ws.on('close', () => {
      console.log(`WebSocket disconnected: ${session.did}`)
      if (writeTimer) clearInterval(writeTimer)
      clients.delete(ws)
      stopPolling()
    })
  })

  httpServer.listen(config.CLIENT_PORT, () => {
    console.log()
    console.log(`Open ${config.PUBLIC_URL} in your browser`)
    console.log('Press Ctrl+C to stop')
  })
}

main().catch(console.error)
