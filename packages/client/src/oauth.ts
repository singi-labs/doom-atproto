/**
 * AT Protocol OAuth client for Doom player authentication.
 *
 * Simplified from Sifa's production OAuth:
 * - In-memory stores (no DB/Valkey needed)
 * - Minimal scopes (just write input records)
 * - Single keypair generated at startup
 */
import { JoseKey, NodeOAuthClient } from '@atproto/oauth-client-node'
import type { NodeSavedSession, NodeSavedSessionStore, NodeSavedState, NodeSavedStateStore } from '@atproto/oauth-client-node'

/** In-memory state store (OAuth authorization state, short-lived) */
class MemoryStateStore implements NodeSavedStateStore {
  private store = new Map<string, NodeSavedState>()

  async get(key: string): Promise<NodeSavedState | undefined> {
    return this.store.get(key)
  }

  async set(key: string, val: NodeSavedState): Promise<void> {
    this.store.set(key, val)
    // Auto-expire after 10 minutes
    setTimeout(() => this.store.delete(key), 600_000)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }
}

/** In-memory session store (OAuth sessions, longer-lived) */
class MemorySessionStore implements NodeSavedSessionStore {
  private store = new Map<string, NodeSavedSession>()

  async get(key: string): Promise<NodeSavedSession | undefined> {
    return this.store.get(key)
  }

  async set(key: string, val: NodeSavedSession): Promise<void> {
    this.store.set(key, val)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }
}

export interface OAuthConfig {
  /** Public URL of the client (e.g. https://doom.singi.dev) */
  publicUrl: string
}

export async function createOAuthClient(config: OAuthConfig): Promise<NodeOAuthClient> {
  // Generate a fresh keypair on startup (sessions don't survive restart -- fine for a game)
  // The key needs a 'kid' for private_key_jwt authentication
  const key = await JoseKey.generate(['ES256'], crypto.randomUUID())

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: `${config.publicUrl}/oauth/client-metadata.json`,
      client_name: 'Doom over AT Protocol',
      client_uri: config.publicUrl,
      response_types: ['code'],
      grant_types: ['authorization_code', 'refresh_token'],
      scope: 'atproto',
      redirect_uris: [`${config.publicUrl}/oauth/callback`],
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: 'private_key_jwt',
      token_endpoint_auth_signing_alg: 'ES256',
      jwks_uri: `${config.publicUrl}/oauth/jwks.json`,
    },
    keyset: [key],
    stateStore: new MemoryStateStore(),
    sessionStore: new MemorySessionStore(),
  })
}
