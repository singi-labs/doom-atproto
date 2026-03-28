# WASM Build

This directory will contain the Emscripten build configuration for compiling
[doomgeneric](https://github.com/ozkl/doomgeneric) to WebAssembly.

## Prerequisites

- Emscripten SDK (emsdk)
- DOOM1.WAD (shareware) in the project root

## Build (coming in Phase 1)

```bash
# Install emsdk
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest

# Build doom.wasm
make
```

The build produces `doom.wasm` and `doom.js` which are loaded by the server package.
