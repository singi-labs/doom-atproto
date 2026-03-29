import { z } from 'zod'

const envSchema = z.object({
  /** AT Protocol PDS URL (e.g. https://bsky.social) */
  ATP_SERVICE: z.string().url(),
  /**
   * Comma-separated list of handle:password pairs for server bot accounts.
   * Cycles to next account when approaching rate limits.
   * Format: "bot1.bsky.social:app-pass-1,bot2.bsky.social:app-pass-2"
   */
  ATP_ACCOUNTS: z.string().min(1),
  /** Player DID to accept inputs from (optional -- set via API) */
  PLAYER_DID: z.string().startsWith('did:').optional(),
  /** WAD file path */
  WAD_PATH: z.string().default('doom1.wad'),
  /** Port for local WebSocket debug server */
  DEBUG_PORT: z.coerce.number().default(8666),
})

export interface BotAccount {
  identifier: string
  password: string
}

export function parseBotAccounts(accountsStr: string): BotAccount[] {
  return accountsStr.split(',').map(pair => {
    const [identifier, password] = pair.trim().split(':')
    if (!identifier || !password) throw new Error(`Invalid account format: "${pair}". Expected "handle:password"`)
    return { identifier, password }
  })
}

export type Config = z.infer<typeof envSchema>

export function loadConfig(): Config {
  return envSchema.parse(process.env)
}
