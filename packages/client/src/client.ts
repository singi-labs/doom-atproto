/**
 * Doom over AT Protocol -- Player Client (Jetstream)
 *
 * Serves browser UI, handles OAuth login, writes input records
 * to player's PDS, receives frame records via Jetstream.
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, WebSocket } from 'ws'
import { Agent } from '@atproto/api'
import { AtpAgent } from '@atproto/api'
import { createOAuthClient } from './oauth.js'
import { loadConfig } from './config.js'
import { LEXICON_IDS } from '@singi-labs/doom-lexicons'
import { createJetstreamClient } from './jetstream.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const config = loadConfig()

  console.log('Doom AT Protocol -- Player Client (Jetstream)')
  console.log(`  Public URL: ${config.PUBLIC_URL}`)
  const serverDids = config.SERVER_DIDS.split(',').map(d => d.trim())
  console.log(`  Server DIDs: ${serverDids.join(', ')}`)
  console.log(`  Port: ${config.CLIENT_PORT}`)
  console.log()

  // Initialize OAuth client
  const oauthClient = await createOAuthClient({ publicUrl: config.PUBLIC_URL })
  console.log('OAuth client ready')

  // Track player sessions
  const playerSessions = new Map<string, { did: string; handle: string; agent: Agent }>()

  // PDS agent for fetching blobs from the server bot's PDS
  // Use localhost since we're on the same machine as the PDS
  const pdsAgent = new AtpAgent({ service: 'http://localhost:3000' })

  // Read browser HTML
  const clientHtml = await readFile(join(__dirname, '..', 'public', 'index.html'), 'utf-8')

  // HTTP server
  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

    try {
      if (url.pathname === '/oauth/client-metadata.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(oauthClient.clientMetadata))
        return
      }

      if (url.pathname === '/oauth/jwks.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(oauthClient.jwks))
        return
      }

      if (url.pathname === '/oauth/login' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const { handle } = JSON.parse(body)
        if (!handle || typeof handle !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Handle is required' }))
          return
        }

        let normalizedHandle = handle.trim().replace(/^@/, '')
        if (!normalizedHandle.includes('.')) {
          normalizedHandle += '.bsky.social'
        }

        // Try granular scope first, fall back to transition:generic
        try {
          const authUrl = await oauthClient.authorize(normalizedHandle, {
            scope: 'atproto repo:dev.singi.doom.input',
          })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ redirectUrl: authUrl.toString() }))
        } catch (granularErr) {
          console.log('Granular scope rejected:', granularErr instanceof Error ? granularErr.message : granularErr)
          console.log('Falling back to transition:generic')
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
          const agent = new Agent(session)

          let handle: string = did
          try {
            const publicAgent = new Agent('https://public.api.bsky.app')
            const profile = await publicAgent.getProfile({ actor: did as `did:plc:${string}` })
            handle = profile.data.handle
          } catch { /* use DID as fallback */ }

          playerSessions.set(sessionId, { did, handle, agent })

          // Notify game server
          try {
            await fetch(`http://localhost:8666/api/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ playerDid: did }),
            })
          } catch (err) {
            console.error('Failed to notify server:', err)
          }

          console.log(`Player authenticated: ${handle} (${did})`)

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

      if (url.pathname === '/api/session') {
        const cookie = req.headers.cookie ?? ''
        const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
        const session = sessionId ? playerSessions.get(sessionId) : undefined
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(session
          ? { authenticated: true, did: session.did, handle: session.handle }
          : { authenticated: false }
        ))
        return
      }

      if (url.pathname === '/oauth/logout' && req.method === 'POST') {
        const cookie = req.headers.cookie ?? ''
        const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
        if (sessionId) playerSessions.delete(sessionId)
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': 'doom_session=; Path=/; Max-Age=0',
        })
        res.end(JSON.stringify({ status: 'ok' }))
        return
      }

      if (url.pathname === '/ws') return

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(clientHtml)
    } catch (err) {
      console.error('Request error:', err)
      res.writeHead(500); res.end('Internal server error')
    }
  })

  // WebSocket for browser communication
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  const clients = new Map<WebSocket, { did: string }>()

  // Jetstream: subscribe to frame records from the game server
  let frameCount = 0
  let latestFramePng: Buffer | null = null
  let latestFrameMeta: { tick: number; latency: number } | null = null

  const jetstream = createJetstreamClient({
    collections: [LEXICON_IDS.DoomFrame],
    wantedDids: serverDids,
    onEvent: async (event) => {
      if (event.kind !== 'commit' || event.commit?.operation !== 'create') return
      if (event.commit.collection !== LEXICON_IDS.DoomFrame) return

      // Extract blob CID from the record (not the record CID)
      const record = event.commit.record as {
        seq?: number
        createdAt?: string
        frames?: Array<{ ref?: { $link?: string } }>
      } | undefined

      const blobCid = record?.frames?.[0]?.ref?.$link
      if (!blobCid) return

      // Skip stale frames (older than 10 seconds) -- prevents replaying backlog
      if (record?.createdAt) {
        const age = Date.now() - new Date(record.createdAt).getTime()
        if (age > 10_000) return
      }

      try {
        const blobResponse = await pdsAgent.com.atproto.sync.getBlob({
          did: event.did,
          cid: blobCid,
        })

        const png = Buffer.from(blobResponse.data as unknown as ArrayBuffer)
        frameCount++

        // Cache latest frame for new browser connections
        const meta = { tick: record?.seq ?? frameCount, latency: record?.createdAt ? Date.now() - new Date(record.createdAt).getTime() : 0 }
        latestFramePng = png
        latestFrameMeta = meta

        if (frameCount <= 3 || frameCount % 20 === 0) {
          console.log(`Frame ${frameCount}: ${png.length}b via Jetstream (blob: ${blobCid.slice(0, 20)}...)`)
        }

        // Send to all connected browser clients
        for (const [ws] of clients) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(png)
            ws.send(JSON.stringify({
              tick: record?.seq ?? frameCount,
              latency: record?.createdAt ? Date.now() - new Date(record.createdAt).getTime() : 0,
            }))
          }
        }
      } catch (err) {
        console.error('Failed to fetch frame blob:', err instanceof Error ? err.message : err)
      }
    },
  })

  // Start Jetstream immediately (listens for server's frame records)
  jetstream.connect()

  wss.on('connection', (ws, req) => {
    const cookie = req.headers.cookie ?? ''
    const sessionId = cookie.match(/doom_session=([^;]+)/)?.[1]
    const session = sessionId ? playerSessions.get(sessionId) : undefined

    if (!session) {
      ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }))
      ws.close()
      return
    }

    console.log(`Browser connected: ${session.handle}`)
    clients.set(ws, { did: session.did })

    // Send the latest cached frame immediately so the browser doesn't wait
    if (latestFramePng && latestFrameMeta) {
      ws.send(latestFramePng)
      ws.send(JSON.stringify(latestFrameMeta))
    }

    // Input handling: batch key states, write to PDS
    const playerAgent = session.agent
    const playerDid = session.did
    let pendingKeys: number[] = []
    let inputSeq = 0
    let inputPaused = false

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
            session: { uri: `at://${serverDids[0]}/${LEXICON_IDS.DoomSession}/current`, cid: 'placeholder' },
            seq,
            keys,
            createdAt: new Date().toISOString(),
          },
        })
      } catch (err) {
        console.error('Input write failed:', err instanceof Error ? err.message : err)
      }
    }

    const writeTimer = setInterval(() => {
      if (!inputPaused) flushInputs()
    }, 500)

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'key') {
        pendingKeys.push(msg.keys ?? 0)
      } else if (msg.type === 'pause') {
        inputPaused = true
        pendingKeys = []
        console.log(`${session.handle} paused`)
      } else if (msg.type === 'resume') {
        inputPaused = false
        console.log(`${session.handle} resumed`)
      }
    })

    ws.on('close', () => {
      clearInterval(writeTimer)
      clients.delete(ws)
      console.log(`Browser disconnected: ${session.handle}`)
    })
  })

  httpServer.listen(config.CLIENT_PORT, () => {
    console.log()
    console.log(`Open ${config.PUBLIC_URL}`)
  })
}

main().catch(console.error)
