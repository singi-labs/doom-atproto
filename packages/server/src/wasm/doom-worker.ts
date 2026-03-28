/**
 * Worker thread that runs the Doom engine.
 *
 * Communicates with the main thread via postMessage:
 *   Main -> Worker: { type: 'init', wadPath: string }
 *   Main -> Worker: { type: 'tick' }
 *   Main -> Worker: { type: 'key', pressed: boolean, key: number }
 *   Worker -> Main: { type: 'ready', width: number, height: number }
 *   Worker -> Main: { type: 'frame', png: Buffer, tick: number, elapsed: number }
 *   Worker -> Main: { type: 'error', message: string }
 */
import { parentPort } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
// Inline the frame encoder to avoid tsx module resolution issues in workers
import { deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 }
  crcTable[n] = c
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) { c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8) }
  return (c ^ 0xffffffff) >>> 0
}
function writeU32BE(buf: Uint8Array, o: number, v: number): void {
  buf[o] = (v >>> 24) & 0xff; buf[o+1] = (v >>> 16) & 0xff; buf[o+2] = (v >>> 8) & 0xff; buf[o+3] = v & 0xff
}
function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(4 + 4 + data.length + 4)
  writeU32BE(chunk, 0, data.length)
  for (let i = 0; i < 4; i++) chunk[4+i] = type.charCodeAt(i)
  chunk.set(data, 8)
  writeU32BE(chunk, 8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}
function encodeFrameToPng(rgba: Uint8Array, width: number, height: number): Buffer {
  const colorMap = new Map<number, number>()
  const palette: number[] = []
  const indices = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const s = i * 4
    const b = rgba[s]!, g = rgba[s+1]!, r = rgba[s+2]!
    const key = (r << 16) | (g << 8) | b
    let idx = colorMap.get(key)
    if (idx === undefined) { idx = colorMap.size; if (idx >= 256) idx = 0; colorMap.set(key, idx); palette.push(r, g, b) }
    indices[i] = idx
  }
  const sig = new Uint8Array([137,80,78,71,13,10,26,10])
  const ihdr = new Uint8Array(13); writeU32BE(ihdr,0,width); writeU32BE(ihdr,4,height); ihdr[8]=8; ihdr[9]=3
  const raw = new Uint8Array(height*(1+width))
  for (let y = 0; y < height; y++) { raw[y*(1+width)]=0; raw.set(indices.subarray(y*width,(y+1)*width), y*(1+width)+1) }
  const compressed = deflateSync(Buffer.from(raw), { level: 6 })
  const chunks = [sig, makeChunk('IHDR',ihdr), makeChunk('PLTE',new Uint8Array(palette)), makeChunk('IDAT',new Uint8Array(compressed)), makeChunk('IEND',new Uint8Array(0))]
  const total = chunks.reduce((s,c)=>s+c.length, 0)
  const out = Buffer.alloc(total); let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

interface DoomModule {
  _doom_init(argc: number, argv: number): void
  _doom_tick(): void
  _doom_add_key(pressed: number, key: number): void
  _doom_get_screen(): number
  _doom_get_screen_width(): number
  _doom_get_screen_height(): number
  _doom_get_tick_count(): number
  _malloc(size: number): number
  _free(ptr: number): void
  HEAPU8: Uint8Array
  HEAPU32: Uint32Array
  FS: {
    writeFile(path: string, data: Uint8Array): void
  }
}

let module: DoomModule | null = null

parentPort!.on('message', async (msg: { type: string; [key: string]: unknown }) => {
  try {
    switch (msg.type) {
      case 'init': {
        const wasmDir = join(__dirname, '..', '..', 'wasm')
        const modulePath = join(wasmDir, 'doom.js')

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const DoomModuleFactory = require(modulePath) as (opts?: Record<string, unknown>) => Promise<DoomModule>
        module = await DoomModuleFactory()

        const wadPath = msg.wadPath as string
        const wadData = await readFile(wadPath)
        module.FS.writeFile('/doom1.wad', new Uint8Array(wadData))

        const args = ['doom', '-iwad', '/doom1.wad']
        const argc = args.length
        const argvPtr = module._malloc(argc * 4)
        const ptrs: number[] = []

        for (const arg of args) {
          const ptr = module._malloc(arg.length + 1)
          for (let i = 0; i < arg.length; i++) {
            module.HEAPU8[ptr + i] = arg.charCodeAt(i)
          }
          module.HEAPU8[ptr + arg.length] = 0
          ptrs.push(ptr)
        }

        for (let i = 0; i < ptrs.length; i++) {
          module.HEAPU32[(argvPtr >> 2) + i] = ptrs[i]!
        }

        module._doom_init(argc, argvPtr)

        parentPort!.postMessage({
          type: 'ready',
          width: module._doom_get_screen_width(),
          height: module._doom_get_screen_height(),
        })
        break
      }

      case 'tick': {
        if (!module) return
        const start = performance.now()

        module._doom_tick()

        const ptr = module._doom_get_screen()
        const width = module._doom_get_screen_width()
        const height = module._doom_get_screen_height()
        const screen = new Uint8Array(module.HEAPU8.buffer, ptr, width * height * 4)

        const png = encodeFrameToPng(screen, width, height)
        const elapsed = performance.now() - start

        parentPort!.postMessage({
          type: 'frame',
          png,
          tick: module._doom_get_tick_count(),
          elapsed: Math.round(elapsed),
        })
        break
      }

      case 'key': {
        if (!module) return
        module._doom_add_key(msg.pressed ? 1 : 0, msg.key as number)
        break
      }
    }
  } catch (err) {
    parentPort!.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
})
