/**
 * Encodes Doom's RGBA framebuffer to PNG.
 *
 * Doom renders at 320x200 with 32-bit RGBA pixels.
 * PNG with indexed palette would be smaller, but raw RGBA PNG
 * is simpler and still compresses well (~3-8KB per frame).
 */
import { PNG } from 'pngjs'

export function encodeFrameToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Buffer {
  const png = new PNG({ width, height })

  // Doom's pixel format is 0xAARRGGBB in memory (little-endian uint32).
  // We need to convert to PNG's RGBA byte order.
  for (let i = 0; i < width * height; i++) {
    const srcOffset = i * 4
    const dstOffset = i * 4

    // Doom stores as BGRX (blue, green, red, unused) in memory on LE systems
    // Actually doomgeneric uses uint32_t with 0x00RRGGBB format
    const b = rgba[srcOffset]!
    const g = rgba[srcOffset + 1]!
    const r = rgba[srcOffset + 2]!

    png.data[dstOffset] = r
    png.data[dstOffset + 1] = g
    png.data[dstOffset + 2] = b
    png.data[dstOffset + 3] = 255 // fully opaque
  }

  return PNG.sync.write(png, { colorType: 2 }) // RGB, no alpha channel needed
}
