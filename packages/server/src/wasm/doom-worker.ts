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
import { PNG } from 'pngjs'

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

function encodeFrameToPng(rgba: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height })
  for (let i = 0; i < width * height; i++) {
    const s = i * 4
    const d = i * 4
    png.data[d] = rgba[s + 2]!     // R (Doom stores BGR)
    png.data[d + 1] = rgba[s + 1]! // G
    png.data[d + 2] = rgba[s]!     // B
    png.data[d + 3] = 255          // A
  }
  return PNG.sync.write(png, { colorType: 2 })
}

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
