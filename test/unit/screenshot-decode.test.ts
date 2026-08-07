/**
 * Unit tests for src/screenshot/decode.ts.
 *
 * Round-trips tiny PNGs through pngjs to make sure `decodePng`,
 * `countColorMatch`, and `diffFraction` behave as advertised — these
 * are the primitives `da_verify_pixels` is built on, so a regression here
 * silently breaks the verification loop.
 */
import { Buffer } from 'node:buffer'
import { describe, it, expect } from 'vitest'
import { PNG } from 'pngjs'
import { DaMcpError } from '../../src/errors.js'
import { decodePng, countColorMatch, diffFraction } from '../../src/screenshot/decode.js'

function makePng(
  width: number,
  height: number,
  fill: { r: number; g: number; b: number; a?: number },
): Buffer {
  const png = new PNG({ width, height, colorType: 6 })
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = fill.r
    png.data[i + 1] = fill.g
    png.data[i + 2] = fill.b
    png.data[i + 3] = fill.a ?? 255
  }
  return PNG.sync.write(png)
}

function makeCheckerPng(
  width: number,
  height: number,
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): Buffer {
  const png = new PNG({ width, height, colorType: 6 })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const isB = (x + y) % 2 === 0
      png.data[idx] = isB ? b.r : a.r
      png.data[idx + 1] = isB ? b.g : a.g
      png.data[idx + 2] = isB ? b.b : a.b
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

describe('decodePng', () => {
  it('decodes a valid PNG buffer into width/height/rgba', () => {
    const buf = makePng(2, 3, { r: 10, g: 20, b: 30 })
    const decoded = decodePng(buf)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(3)
    expect(decoded.rgba.length).toBe(2 * 3 * 4)
    // Pixel (0, 0) is the first 4 bytes.
    expect(Array.from(decoded.rgba.subarray(0, 4))).toEqual([10, 20, 30, 255])
  })

  it('throws SCREENSHOT_EMPTY for an empty buffer', () => {
    expect(() => decodePng(Buffer.alloc(0))).toThrowError(DaMcpError)
    try {
      decodePng(Buffer.alloc(0))
    } catch (err) {
      expect(DaMcpError.is(err)).toBe(true)
      if (DaMcpError.is(err)) expect(err.code).toBe('SCREENSHOT_EMPTY')
    }
  })

  it('throws SCREENSHOT_EMPTY when the magic bytes are wrong', () => {
    const fake = Buffer.from([0x00, 0x00, 0x00, 0x00])
    try {
      decodePng(fake)
      throw new Error('should have thrown')
    } catch (err) {
      expect(DaMcpError.is(err)).toBe(true)
      if (DaMcpError.is(err)) expect(err.code).toBe('SCREENSHOT_EMPTY')
    }
  })

  it('returns its own Uint8Array (no aliasing the pngjs internal buffer)', () => {
    const buf = makePng(2, 2, { r: 1, g: 2, b: 3 })
    const decoded = decodePng(buf)
    decoded.rgba[0] = 99
    // Re-decoding should return the original pixel value — no aliasing.
    const decoded2 = decodePng(buf)
    expect(decoded2.rgba[0]).toBe(1)
  })
})

describe('countColorMatch', () => {
  it('counts pixels matching the target within tolerance (inclusive)', () => {
    const buf = makePng(2, 2, { r: 200, g: 50, b: 50 })
    const img = decodePng(buf)
    // tolerance 0: no exact match (target is [255,0,0])
    expect(countColorMatch(img, [255, 0, 0], 0)).toBe(0)
    // tolerance 60: matches [200,50,50] because (|255-200|, |0-50|, |0-50|) = (55, 50, 50)
    expect(countColorMatch(img, [255, 0, 0], 60)).toBe(4)
  })

  it('counts zero when no pixels match', () => {
    const buf = makePng(2, 2, { r: 0, g: 0, b: 0 })
    const img = decodePng(buf)
    expect(countColorMatch(img, [255, 255, 255], 0)).toBe(0)
  })

  it('handles a checker pattern correctly', () => {
    const buf = makeCheckerPng(2, 2, { r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })
    const img = decodePng(buf)
    // 2x2 checker → 2 black + 2 white pixels
    expect(countColorMatch(img, [0, 0, 0], 0)).toBe(2)
    expect(countColorMatch(img, [255, 255, 255], 0)).toBe(2)
  })
})

describe('diffFraction', () => {
  it('returns 0 for identical images', () => {
    const a = decodePng(makePng(2, 2, { r: 100, g: 100, b: 100 }))
    const b = decodePng(makePng(2, 2, { r: 100, g: 100, b: 100 }))
    expect(diffFraction(a, b, 0)).toBe(0)
  })

  it('returns 1 when all pixels differ beyond tolerance', () => {
    const a = decodePng(makePng(2, 2, { r: 0, g: 0, b: 0 }))
    const b = decodePng(makePng(2, 2, { r: 255, g: 255, b: 255 }))
    expect(diffFraction(a, b, 0)).toBe(1)
  })

  it('tolerance collapses small drift to zero', () => {
    const a = decodePng(makePng(2, 2, { r: 100, g: 100, b: 100 }))
    const b = decodePng(makePng(2, 2, { r: 105, g: 100, b: 100 })) // 5-unit drift on R
    expect(diffFraction(a, b, 0)).toBe(1) // exact diff
    expect(diffFraction(a, b, 5)).toBe(0) // collapsed by tolerance
  })

  it('returns 1 for mismatched dimensions', () => {
    const a = decodePng(makePng(2, 2, { r: 0, g: 0, b: 0 }))
    const b = decodePng(makePng(3, 3, { r: 0, g: 0, b: 0 }))
    expect(diffFraction(a, b, 0)).toBe(1)
  })
})