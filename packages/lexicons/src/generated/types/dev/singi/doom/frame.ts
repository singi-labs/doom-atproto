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
import type * as ComAtprotoRepoStrongRef from '../../../com/atproto/repo/strongRef.js'
import type * as DevSingiDoomDefs from './defs.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'dev.singi.doom.frame'

export interface Main {
  $type: 'dev.singi.doom.frame'
  session: ComAtprotoRepoStrongRef.Main
  /** Sequence number of the first frame in this batch. */
  seq: number
  meta: DevSingiDoomDefs.FrameMeta
  /** Array of frame blobs. Each blob is a PNG-encoded frame. */
  frames: BlobRef[]
  /** Client-declared timestamp when this frame was originally created. */
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
