/**
 * da_verify_pixels — poll the screen until a pixel-level predicate holds.
 *
 * The article on LLM-driven desktop automation identified this as the missing
 * primitive for any non-trivial scenario: agents need to *verify* that an
 * action had the intended visual effect ("did the red circle actually get
 * drawn?") before committing to the next step. Without it, errors compound
 * silently and a single misclick cascades into "stuck in the wrong dialog".
 *
 * Two predicates (extensible; see `Predicate` union):
 *   - `color` — count pixels whose RGB is within `tolerance` per channel of
 *     the target color. Returns when `minCount` is reached.
 *   - `diff`  — decode a baseline PNG, return when >= `threshold` fraction
 *     of pixels differ from it per channel (default tolerance 8). Use this
 *     for "did anything change?" (e.g. circle appeared on a blank canvas).
 *
 * Optional `region` clips both the screenshot and the diff baseline to a
 * rectangle in image-pixel coords (origin top-left). When omitted, the full
 * screenshot is used.
 *
 * Polling cadence: `intervalMs` (default 200, min 50, max 5000). PNG decode
 * happens via `pngjs` (pure JS, no native bindings) so it works in source
 * mode and the Node SEA single-binary build alike.
 *
 * On success: `{ matched: true, predicate: {kind, params}, stats: {...}, waitedMs }`.
 * On timeout: throws `DaMcpError('NOT_FOUND')` with the last observed stats.
 */
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { defineTool } from './types.js'
import { DaMcpError } from '../errors.js'
import { decodePng, countColorMatch, diffFraction, type DecodedPng } from '../screenshot/decode.js'
import { screenshot } from '../screenshot/index.js'
import type { Rect } from '../platform/types.js'

const INT32_MAX = 2147483647
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_INTERVAL_MS = 200
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 5000
const MAX_TIMEOUT_MS = 60000
const MIN_TOLERANCE = 0
const MAX_TOLERANCE = 255

const rgbTuple = z.tuple([
  z.number().int().min(0).max(MAX_TOLERANCE),
  z.number().int().min(0).max(MAX_TOLERANCE),
  z.number().int().min(0).max(MAX_TOLERANCE),
])

const regionSchema = z
  .object({
    x: z.number().int().min(0).max(INT32_MAX),
    y: z.number().int().min(0).max(INT32_MAX),
    width: z.number().int().min(1).max(INT32_MAX),
    height: z.number().int().min(1).max(INT32_MAX),
  })
  .optional()

const colorPredicate = z.object({
  kind: z.literal('color'),
  rgb: rgbTuple,
  tolerance: z.number().int().min(MIN_TOLERANCE).max(MAX_TOLERANCE).optional(),
  minCount: z.number().int().min(1).max(INT32_MAX),
})

const diffPredicate = z.object({
  kind: z.literal('diff'),
  /** Baseline PNG to compare against. Required for `diff`. */
  baseline: z.string().min(1),
  /** Fraction (0..1) of pixels that must differ for the predicate to match. */
  threshold: z.number().min(0).max(1),
  tolerance: z.number().int().min(MIN_TOLERANCE).max(MAX_TOLERANCE).optional(),
})

const predicateSchema = z.discriminatedUnion('kind', [colorPredicate, diffPredicate])

const schema = z.object({
  predicate: predicateSchema,
  region: regionSchema,
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
  timeoutMs: z.number().int().min(0).max(MAX_TIMEOUT_MS).optional(),
  intervalMs: z.number().int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS).optional(),
})

export const daVerifyPixels = defineTool({
  name: 'da_verify_pixels',
  description:
    'Block until a pixel-level predicate holds on the next screenshot, or `timeoutMs` (default 10000, max 60000) elapses. Predicates: {kind:"color", rgb:[r,g,b], tolerance?, minCount} (counts matching pixels, succeeds when count >= minCount); {kind:"diff", baseline:"<base64-PNG>", threshold, tolerance?} (succeeds when >= `threshold` fraction of pixels differ from the baseline PNG). Optional `region` clips the check to a rectangle. Polls every `intervalMs` (default 200). Throws `NOT_FOUND` on timeout. Use this to verify visual state after an action (e.g. "wait until 200+ red pixels appear on the canvas").',
  inputSchema: schema,
  handler: async (input) => {
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS
    const displayId = input.displayId ?? null

    // Pre-decode baseline once (if needed) — re-decoding per poll would
    // dominate runtime on the diff predicate.
    const baseline: DecodedPng | null =
      input.predicate.kind === 'diff'
        ? decodePng(Buffer.from(input.predicate.baseline, 'base64'))
        : null

    const started = Date.now()
    let attempts = 0
    let lastStats: ColorStats | DiffStats | null = null
    while (true) {
      attempts++
      const elapsed = Date.now() - started
      const screenshotBuf = await screenshot(displayId)
      const fullImage = decodePng(screenshotBuf)
      const image = clipToRegion(fullImage, input.region)

      if (input.predicate.kind === 'color') {
        const tolerance = input.predicate.tolerance ?? 0
        const count = countColorMatch(image, input.predicate.rgb, tolerance)
        const stats: ColorStats = { count, totalPixels: image.width * image.height }
        lastStats = stats
        if (count >= input.predicate.minCount) {
          return {
            matched: true,
            predicate: { kind: 'color', rgb: input.predicate.rgb, minCount: input.predicate.minCount, ...(input.predicate.tolerance !== undefined ? { tolerance: input.predicate.tolerance } : {}) },
            stats,
            waitedMs: elapsed,
            attempts,
          }
        }
      } else {
        const tolerance = input.predicate.tolerance ?? 8
        // Diff baseline must also be clipped to the same region so the
        // dimensions align; otherwise the comparator returns 1 (no match).
        const baselineClipped = baseline !== null ? clipToRegion(baseline, input.region) : baseline
        if (baselineClipped === null) {
          throw new DaMcpError(
            'INTERNAL',
            'verify_pixels diff predicate decoded baseline as null',
          )
        }
        const frac = diffFraction(image, baselineClipped, tolerance)
        const stats: DiffStats = {
          diffFraction: frac,
          totalPixels: image.width * image.height,
        }
        lastStats = stats
        if (frac >= input.predicate.threshold) {
          return {
            matched: true,
            predicate: {
              kind: 'diff',
              threshold: input.predicate.threshold,
              ...(input.predicate.tolerance !== undefined ? { tolerance: input.predicate.tolerance } : {}),
            },
            stats,
            waitedMs: elapsed,
            attempts,
          }
        }
      }

      if (elapsed >= timeoutMs) {
        throw new DaMcpError(
          'NOT_FOUND',
          `Pixel predicate ${input.predicate.kind} did not match within ${String(elapsed)}ms (${String(attempts)} attempts; last stats: ${JSON.stringify(lastStats)})`,
        )
      }
      await sleep(intervalMs)
    }
  },
})

interface ColorStats {
  count: number
  totalPixels: number
}

interface DiffStats {
  diffFraction: number
  totalPixels: number
}

/**
 * Clip a decoded image to a region. When `region` is undefined, returns the
 * original (no copy). The returned image always has its own RGBA buffer so
 * callers can mutate freely without aliasing the source.
 */
function clipToRegion(img: DecodedPng, region: Rect | undefined): DecodedPng {
  if (region === undefined) return img
  const { x, y, width, height } = region
  const w = Math.min(width, img.width - x)
  const h = Math.min(height, img.height - y)
  if (w <= 0 || h <= 0) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `verify_pixels region (${String(x)},${String(y)} ${String(width)}x${String(height)}) is outside image ${String(img.width)}x${String(img.height)}`,
    )
  }
  const out = new Uint8Array(w * h * 4)
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * img.width + x) * 4
    const dstStart = row * w * 4
    out.set(img.rgba.subarray(srcStart, srcStart + w * 4), dstStart)
  }
  return { width: w, height: h, rgba: out }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}