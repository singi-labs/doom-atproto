/**
 * WASM bridge for doomgeneric.
 *
 * Loads the compiled doom.wasm module and provides a TypeScript API
 * for tick-by-tick game control.
 */
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** Doom key codes (from doomkeys.h) */
export const DOOM_KEYS = {
  ENTER: 13,
  ESCAPE: 27,
  TAB: 9,
  UPARROW: 0xad,
  DOWNARROW: 0xaf,
  LEFTARROW: 0xac,
  RIGHTARROW: 0xae,
  FIRE: 0xa3,
  USE: 0xa2,
  STRAFE_L: 0xa0,
  STRAFE_R: 0xa1,
  RSHIFT: 0x80 + 0x36,  // speed/run
  RALT: 0x80 + 0x38,    // strafe
  F1: 0x80 + 0x3b,
  F2: 0x80 + 0x3c,
  F3: 0x80 + 0x3d,
  F4: 0x80 + 0x3e,
  F5: 0x80 + 0x3f,
  F6: 0x80 + 0x40,
  F7: 0x80 + 0x41,
  F8: 0x80 + 0x42,
  F9: 0x80 + 0x43,
  F10: 0x80 + 0x44,
  F11: 0x80 + 0x57,
  PAUSE: 0xff,
  EQUALS: 0x3d,
  MINUS: 0x2d,
  // Regular keys are just their ASCII lowercase value
} as const

export interface DoomEngine {
  /** Initialize the engine with the WAD file */
  init(wadPath: string): Promise<void>
  /** Run one game tick */
  tick(): void
  /** Add a key event to the queue (called before tick) */
  addKey(pressed: boolean, key: number): void
  /** Get the current framebuffer as an RGBA Uint8Array (320x200x4) */
  getScreen(): Uint8Array
  /** Get screen width */
  getScreenWidth(): number
  /** Get screen height */
  getScreenHeight(): number
  /** Get current tick count */
  getTickCount(): number
}

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
    mkdir(path: string): void
  }
}

export async function createDoomEngine(): Promise<DoomEngine> {
  // Load the Emscripten-generated JS module (CommonJS format)
  const wasmDir = join(__dirname, '..', '..', 'wasm')
  const modulePath = join(wasmDir, 'doom.js')

  // Emscripten MODULARIZE outputs: var DoomModule = (async function(opts) { ... })
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DoomModuleFactory = require(modulePath) as (opts?: Record<string, unknown>) => Promise<DoomModule>
  const module: DoomModule = await DoomModuleFactory()

  return {
    async init(wadPath: string) {
      // Read WAD file and write it to Emscripten's virtual filesystem
      const wadData = await readFile(wadPath)
      module.FS.writeFile('/doom1.wad', new Uint8Array(wadData))

      // Set up argv: program name + WAD path
      // Allocate strings in WASM memory
      const progName = 'doom'
      const iwadArg = '-iwad'
      const iwadPath = '/doom1.wad'

      const args = [progName, iwadArg, iwadPath]
      const argc = args.length

      // Allocate argv array
      const argvPtr = module._malloc(argc * 4) // array of pointers
      const ptrs: number[] = []

      for (const arg of args) {
        const ptr = module._malloc(arg.length + 1)
        for (let i = 0; i < arg.length; i++) {
          module.HEAPU8[ptr + i] = arg.charCodeAt(i)
        }
        module.HEAPU8[ptr + arg.length] = 0 // null terminator
        ptrs.push(ptr)
      }

      // Write pointers to argv array
      for (let i = 0; i < ptrs.length; i++) {
        module.HEAPU32[(argvPtr >> 2) + i] = ptrs[i]!
      }

      module._doom_init(argc, argvPtr)
    },

    tick() {
      module._doom_tick()
    },

    addKey(pressed: boolean, key: number) {
      module._doom_add_key(pressed ? 1 : 0, key)
    },

    getScreen(): Uint8Array {
      const ptr = module._doom_get_screen()
      const width = module._doom_get_screen_width()
      const height = module._doom_get_screen_height()
      const size = width * height * 4 // RGBA
      return new Uint8Array(module.HEAPU8.buffer, ptr, size)
    },

    getScreenWidth(): number {
      return module._doom_get_screen_width()
    },

    getScreenHeight(): number {
      return module._doom_get_screen_height()
    },

    getTickCount(): number {
      return module._doom_get_tick_count()
    },
  }
}
