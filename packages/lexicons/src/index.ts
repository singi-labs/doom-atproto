/**
 * Doom over AT Protocol -- Lexicon types and constants.
 *
 * Lexicon JSON schemas live in ../lexicons/dev/singi/doom/.
 * Generated types live in ./generated/ (run `pnpm generate` to regenerate).
 */

// Re-export generated types
export * from './generated/index.js'
export * as DevSingiDoomDefs from './generated/types/dev/singi/doom/defs.js'
export * as DevSingiDoomSession from './generated/types/dev/singi/doom/session.js'
export * as DevSingiDoomInput from './generated/types/dev/singi/doom/input.js'
export * as DevSingiDoomFrame from './generated/types/dev/singi/doom/frame.js'
export * as DevSingiDoomArtifact from './generated/types/dev/singi/doom/artifact.js'

export const LEXICON_IDS = {
  DoomDefs: 'dev.singi.doom.defs',
  DoomSession: 'dev.singi.doom.session',
  DoomInput: 'dev.singi.doom.input',
  DoomFrame: 'dev.singi.doom.frame',
  DoomArtifact: 'dev.singi.doom.artifact',
} as const

export type LexiconId = (typeof LEXICON_IDS)[keyof typeof LEXICON_IDS]

/**
 * Key bitmask bit positions for Doom input.
 * Use: keys |= (1 << KEY_BITS.forward) to set,
 *      keys & (1 << KEY_BITS.fire) to check.
 */
export const KEY_BITS = {
  forward: 0,
  backward: 1,
  left: 2,
  right: 3,
  fire: 4,
  use: 5,
  strafe: 6,
  speed: 7,
  weapon1: 8,
  weapon2: 9,
  weapon3: 10,
  weapon4: 11,
  weapon5: 12,
  weapon6: 13,
  weapon7: 14,
  weapon8: 15,
  escape: 16,
  enter: 17,
  tab: 18,
  pause: 19,
} as const

export type KeyName = keyof typeof KEY_BITS
