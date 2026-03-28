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
const id = 'dev.singi.doom.artifact'

export interface Main {
  $type: 'dev.singi.doom.artifact'
  /** Asset identifier (e.g. 'doom1-wad', 'engine-wasm'). */
  name: string
  /** Zero-based chunk index within the asset. */
  index: number
  /** Total number of chunks for this asset. */
  totalChunks: number
  /** SHA-256 hex digest of the complete reassembled asset (same across all chunks). */
  hash: string
  /** Chunk payload (up to 1MB). */
  data: BlobRef
  /** Client-declared timestamp when this artifact was originally created. */
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
