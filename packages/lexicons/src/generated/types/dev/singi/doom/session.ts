/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type ValidationResult, BlobRef } from '@atproto/lexicon'
import { CID } from 'multiformats/cid'
import { validate as _validate } from '../../../../lexicons.js'
import {
  type $Typed,
  is$typed as _is$typed,
  type OmitKey,
} from '../../../../util.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'dev.singi.doom.session'

export interface Main {
  $type: 'dev.singi.doom.session'
  /** WAD file identifier (e.g. 'doom1-shareware'). */
  wad: string
  /** DID of the player for this session. */
  player: string
  /** Current session status. */
  status:
    | 'dev.singi.doom.session#active'
    | 'dev.singi.doom.session#paused'
    | 'dev.singi.doom.session#ended'
    | (string & {})
  /** Target ticks per second (Doom default: 35). */
  tickRate: number
  /** Total ticks processed so far. */
  totalTicks?: number
  /** Client-declared timestamp when this session was originally created. */
  createdAt: string
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}

/** Session is actively running. */
export const ACTIVE = `${id}#active`
/** Session is paused. */
export const PAUSED = `${id}#paused`
/** Session has ended. */
export const ENDED = `${id}#ended`
