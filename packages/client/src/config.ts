import { z } from 'zod'

const envSchema = z.object({
  /** Public URL of the client (e.g. https://doom.singi.dev) */
  PUBLIC_URL: z.string().url().default('http://localhost:8667'),
  /** Game server DID to subscribe to for frames */
  SERVER_DID: z.string().startsWith('did:'),
  /** Port for local HTTP server */
  CLIENT_PORT: z.coerce.number().default(8667),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(): Config {
  return envSchema.parse(process.env)
}
