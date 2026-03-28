import { z } from 'zod'

const envSchema = z.object({
  /** AT Protocol PDS URL (e.g. https://bsky.social) */
  ATP_SERVICE: z.string().url(),
  /** AT Protocol handle or DID */
  ATP_IDENTIFIER: z.string().min(1),
  /** AT Protocol app password */
  ATP_PASSWORD: z.string().min(1),
  /** Player DID to accept inputs from (optional -- set via API) */
  PLAYER_DID: z.string().startsWith('did:').optional(),
  /** WAD file path */
  WAD_PATH: z.string().default('doom1.wad'),
  /** Port for local WebSocket debug server */
  DEBUG_PORT: z.coerce.number().default(8666),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(): Config {
  return envSchema.parse(process.env)
}
