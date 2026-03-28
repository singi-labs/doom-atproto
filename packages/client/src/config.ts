import { z } from 'zod'

const envSchema = z.object({
  /** AT Protocol PDS URL (e.g. https://bsky.social) */
  ATP_SERVICE: z.string().url(),
  /** AT Protocol handle or DID */
  ATP_IDENTIFIER: z.string().min(1),
  /** AT Protocol app password */
  ATP_PASSWORD: z.string().min(1),
  /** Game server DID to subscribe to for frames */
  SERVER_DID: z.string().startsWith('did:'),
  /** Port for local browser UI */
  CLIENT_PORT: z.coerce.number().default(8667),
})

export type Config = z.infer<typeof envSchema>

export function loadConfig(): Config {
  return envSchema.parse(process.env)
}
