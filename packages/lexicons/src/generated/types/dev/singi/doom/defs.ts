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
const id = 'dev.singi.doom.defs'

/** Bitmask of currently pressed keys for one game tick. */
export interface KeyState {
  $type?: 'dev.singi.doom.defs#keyState'
  /** Bitmask of pressed keys. Bit 0=forward, 1=backward, 2=left, 3=right, 4=fire, 5=use, 6=strafe, 7=speed, 8-15=weapon select, 16=escape, 17=enter, 18=tab (map), 19=pause. */
  keys: number
}

const hashKeyState = 'keyState'

export function isKeyState<V>(v: V) {
  return is$typed(v, id, hashKeyState)
}

export function validateKeyState<V>(v: V) {
  return validate<KeyState & V>(v, id, hashKeyState)
}

/** Metadata about a rendered frame. */
export interface FrameMeta {
  $type?: 'dev.singi.doom.defs#frameMeta'
  /** Frame width in pixels. */
  width: number
  /** Frame height in pixels. */
  height: number
  /** How the frame data is encoded. */
  encoding:
    | 'dev.singi.doom.defs#encodingPng'
    | 'dev.singi.doom.defs#encodingPaletteRle'
    | (string & {})
}

const hashFrameMeta = 'frameMeta'

export function isFrameMeta<V>(v: V) {
  return is$typed(v, id, hashFrameMeta)
}

export function validateFrameMeta<V>(v: V) {
  return validate<FrameMeta & V>(v, id, hashFrameMeta)
}

/** Frame encoded as PNG image blob. */
export const ENCODINGPNG = `${id}#encodingPng`
/** Frame encoded as RLE-compressed palette-indexed buffer. */
export const ENCODINGPALETTERLE = `${id}#encodingPaletteRle`
