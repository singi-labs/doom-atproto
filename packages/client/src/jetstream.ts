/**
 * Jetstream client for subscribing to AT Protocol events.
 * Simplified from Sifa's production Jetstream client.
 */
import WebSocket from 'ws'

export interface JetstreamEvent {
  did: string
  time_us: number
  kind: 'commit' | 'identity' | 'account'
  commit?: {
    rev: string
    operation: 'create' | 'update' | 'delete'
    collection: string
    rkey: string
    record?: Record<string, unknown>
    cid?: string
  }
}

const JETSTREAM_URLS = [
  'wss://jetstream1.us-east.bsky.network/subscribe',
  'wss://jetstream2.us-east.bsky.network/subscribe',
  'wss://jetstream1.us-west.bsky.network/subscribe',
  'wss://jetstream2.us-west.bsky.network/subscribe',
]

export interface JetstreamOptions {
  /** Collections to subscribe to */
  collections: string[]
  /** Optional: only receive events from these DIDs */
  wantedDids?: string[]
  /** Called for each event */
  onEvent: (event: JetstreamEvent) => void
}

export function createJetstreamClient(opts: JetstreamOptions) {
  let ws: WebSocket | null = null
  let running = false
  let reconnectDelay = 1000
  let urlIndex = 0

  function buildUrl(): string {
    const base = JETSTREAM_URLS[urlIndex % JETSTREAM_URLS.length]!
    const url = new URL(base)
    for (const col of opts.collections) {
      url.searchParams.append('wantedCollections', col)
    }
    if (opts.wantedDids) {
      for (const did of opts.wantedDids) {
        url.searchParams.append('wantedDids', did)
      }
    }
    return url.toString()
  }

  function connect() {
    running = true
    const url = buildUrl()
    console.log(`Jetstream connecting to ${JETSTREAM_URLS[urlIndex % JETSTREAM_URLS.length]}`)

    ws = new WebSocket(url)

    ws.on('open', () => {
      console.log('Jetstream connected')
      reconnectDelay = 1000
    })

    ws.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString()) as JetstreamEvent
        opts.onEvent(event)
      } catch (err) {
        console.error('Failed to parse Jetstream event:', err)
      }
    })

    ws.on('close', () => {
      if (running) {
        urlIndex++
        console.log(`Jetstream disconnected, reconnecting in ${reconnectDelay}ms`)
        setTimeout(connect, reconnectDelay)
        reconnectDelay = Math.min(reconnectDelay * 2, 30000)
      }
    })

    ws.on('error', (err) => {
      console.error('Jetstream error:', err.message)
    })
  }

  function disconnect() {
    running = false
    ws?.close()
  }

  /** Update the DID filter (reconnects) */
  function setWantedDids(dids: string[]) {
    opts.wantedDids = dids
    if (running && ws) {
      ws.close() // will trigger reconnect with new DIDs
    }
  }

  return { connect, disconnect, setWantedDids }
}
