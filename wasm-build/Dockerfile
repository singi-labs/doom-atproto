# Reproducible WASM build for Doom over AT Protocol
#
# Usage:
#   docker build -t doom-wasm-builder .
#   docker run --rm -v $(pwd)/..:/workspace doom-wasm-builder
#
# Output: doom.js + doom.wasm in wasm-build/

FROM emscripten/emsdk:3.1.74

WORKDIR /workspace/wasm-build

CMD ["make", "clean", "all"]
