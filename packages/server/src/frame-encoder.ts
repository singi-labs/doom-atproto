/**
 * Encodes Doom's RGBA framebuffer to PNG.
 *
 * Uses indexed palette mode (colorType 3) since Doom renders with
 * a fixed 256-color palette. This produces much smaller PNGs
 * (~5-15KB vs ~90KB for RGB mode).
 */
import { deflateSync } from 'node:zlib'

// CRC32 lookup table for PNG chunks
const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  crcTable[n] = c
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff
  buf[offset + 1] = (val >>> 16) & 0xff
  buf[offset + 2] = (val >>> 8) & 0xff
  buf[offset + 3] = val & 0xff
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  writeU32BE(chunk, 0, data.length)
  chunk[4] = type.charCodeAt(0)
  chunk[5] = type.charCodeAt(1)
  chunk[6] = type.charCodeAt(2)
  chunk[7] = type.charCodeAt(3)
  chunk.set(data, 8)
  // CRC covers type + data
  const crcData = chunk.subarray(4, 8 + data.length)
  writeU32BE(chunk, 8 + data.length, crc32(crcData))
  return chunk
}

export function encodeFrameToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  // Build palette from unique colors in the frame
  const colorMap = new Map<number, number>() // rgb packed -> palette index
  const palette: number[] = [] // flat r,g,b values

  // Scan pixels and build palette (Doom has max 256 colors)
  const indices = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const s = i * 4
    // Doom's framebuffer is BGRX on little-endian
    const b = rgba[s]!
    const g = rgba[s + 1]!
    const r = rgba[s + 2]!
    const key = (r << 16) | (g << 8) | b

    let idx = colorMap.get(key)
    if (idx === undefined) {
      idx = colorMap.size
      if (idx >= 256) {
        // Fallback: more than 256 colors, shouldn't happen with Doom
        // but just in case, clamp to nearest existing
        idx = 0
      }
      colorMap.set(key, idx)
      palette.push(r, g, b)
    }
    indices[i] = idx
  }

  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdr = new Uint8Array(13)
  writeU32BE(ihdr, 0, width)
  writeU32BE(ihdr, 4, height)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 3  // color type: indexed
  ihdr[10] = 0 // compression: deflate
  ihdr[11] = 0 // filter: adaptive
  ihdr[12] = 0 // interlace: none
  const ihdrChunk = makeChunk('IHDR', ihdr)

  // PLTE chunk
  const plteData = new Uint8Array(palette)
  const plteChunk = makeChunk('PLTE', plteData)

  // IDAT chunk: filter byte (0 = none) + palette indices per row
  const rawData = new Uint8Array(height * (1 + width))
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width)] = 0 // filter: none
    rawData.set(
      indices.subarray(y * width, (y + 1) * width),
      y * (1 + width) + 1,
    )
  }
  const compressed = deflateSync(Buffer.from(rawData), { level: 6 })
  const idatChunk = makeChunk('IDAT', new Uint8Array(compressed))

  // IEND chunk
  const iendChunk = makeChunk('IEND', new Uint8Array(0))

  // Assemble
  const totalLen =
    signature.length +
    ihdrChunk.length +
    plteChunk.length +
    idatChunk.length +
    iendChunk.length

  const out = Buffer.alloc(totalLen)
  let offset = 0
  out.set(signature, offset); offset += signature.length
  out.set(ihdrChunk, offset); offset += ihdrChunk.length
  out.set(plteChunk, offset); offset += plteChunk.length
  out.set(idatChunk, offset); offset += idatChunk.length
  out.set(iendChunk, offset)

  return out
}
