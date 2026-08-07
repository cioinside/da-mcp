/**
 * PNG decode helper — buffer → {width, height, rgba}.
 *
 * Sits beside `png.ts` (validation/mock fixtures) because it has a different
 * responsibility: turning a raw PNG byte stream into a flat RGBA buffer that
 * pixel-level predicates can grep through.
 *
 * Uses `pngjs` (pure JS, no native bindings) so the helper works the same in
 * source mode, the Node SEA single-binary build, and the test harness. The
 * synchronous API is used so callers (e.g. `da_verify_pixels`) can decide
 * their own polling cadence without juggling Promises.
 *
 * Throws `DaMcpError('SCREENSHOT_EMPTY')` for empty/invalid input — the same
 * code the screenshot module uses for "the image you handed me is not a
 * real PNG", so callers can rely on a single error code across the surface.
 */
import { Buffer } from 'node:buffer'
import { PNG } from 'pngjs'
import { DaMcpError } from '../errors.js'
import { validatePngBuffer } from './png.js'

export interface DecodedPng {
  readonly width: number
  readonly height: number
  /** RGBA, 4 bytes per pixel, top-to-bottom, left-to-right. Length = width*height*4. */
  readonly rgba: Uint8Array
}

/**
 * Decode a PNG buffer into a flat RGBA byte array.
 *
 * Throws `DaMcpError('SCREENSHOT_EMPTY')` when `buf` is empty or not a PNG.
 * palescape only; decompression errors re-thrown as `DaMcpError('NATIVE_FAILED')`.
 */
export function decodePng(buf: Buffer): DecodedPng {
  validatePngBuffer(buf)
  let parsed: ReturnType<typeof PNG.sync.read>
  try {
    parsed = PNG.sync.read(buf)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new DaMcpError('NATIVE_FAILED', `PNG decode failed: ${msg}`, err)
  }
  const { width, height, data } = parsed
  if (width <= 0 || height <= 0) {
    throw new DaMcpError(
      'SCREENSHOT_EMPTY',
      `PNG decode produced zero-sized image (${String(width)}x${String(height)})`,
    )
  }
  // pngjs always returns 4 bytes per pixel (RGBA) regardless of source colorType —
  // it upconverts on the fly. Copy to a fresh Uint8Array so callers can safely
  // use it without aliasing pngjs's internal Buffer.
  const rgba = new Uint8Array(width * height * 4)
  rgba.set(data)
  return { width, height, rgba }
}

/**
 * Read a single pixel from a decoded image. Returns [r, g, b, a] in 0..255.
 * Coordinates are in image pixel space (origin top-left).
 */
export function pixelAt(img: DecodedPng, x: number, y: number): readonly [number, number, number, number] {
  const { width, rgba } = img
  const i = (y * width + x) * 4
  return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0, rgba[i + 3] ?? 0]
}

/**
 * Count pixels whose RGB falls within `tolerance` of `target` per channel.
 * Alpha is ignored — `tolerance` is on chromatic channels only because the
 * screen-capture pipeline upconverts to opaque RGBA on most platforms.
 */
export function countColorMatch(
  img: DecodedPng,
  target: readonly [number, number, number],
  tolerance: number,
): number {
  const { width, height, rgba } = img
  const [tr, tg, tb] = target
  let count = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] ?? 0
    const g = rgba[i + 1] ?? 0
    const b = rgba[i + 2] ?? 0
    if (
      Math.abs(r - tr) <= tolerance &&
      Math.abs(g - tg) <= tolerance &&
      Math.abs(b - tb) <= tolerance
    ) {
      count++
    }
  }
  void width
  void height
  return count
}

/**
 * Compare two decoded images pixel-by-pixel. Returns the fraction of pixels
 * (0..1) whose RGB differs by more than `tolerance` per channel. Useful for
 * "anything changed since the baseline" waiting.
 */
export function diffFraction(
  a: DecodedPng,
  b: DecodedPng,
  tolerance: number,
): number {
  if (a.width !== b.width || a.height !== b.height) {
    return 1
  }
  if (a.rgba.length !== b.rgba.length) return 1
  const len = a.rgba.length
  let diff = 0
  const pixels = len / 4
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs((a.rgba[i] ?? 0) - (b.rgba[i] ?? 0))
    const dg = Math.abs((a.rgba[i + 1] ?? 0) - (b.rgba[i + 1] ?? 0))
    const db = Math.abs((a.rgba[i + 2] ?? 0) - (b.rgba[i + 2] ?? 0))
    if (dr > tolerance || dg > tolerance || db > tolerance) diff++
  }
  return pixels === 0 ? 0 : diff / pixels
}
