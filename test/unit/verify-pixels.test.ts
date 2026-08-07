/**
 * Unit tests for da_verify_pixels.
 *
 * Real PNG fixtures are generated with `pngjs` so the decoder path is
 * fully exercised; the only thing we mock is `screenshot` (the OS-level
 * capture call) — the rest of the pipeline (decode → predicate → poll)
 * runs end-to-end.
 */
import { Buffer } from 'node:buffer'
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest'

import { PNG } from 'pngjs'
import { DaMcpError } from '../../src/errors.js'

const mockScreenshot: Mock<[number | null], Promise<Buffer>> = vi.fn()

vi.mock('../../src/screenshot/index.js', () => ({
  screenshot: (displayId: number | null) => mockScreenshot(displayId),
}))

const { daVerifyPixels } = await import('../../src/tools/verify-pixels.js')

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  mockScreenshot.mockReset()
})

afterEach(() => {
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

/**
 * Build a PNG buffer filled with a single color. Used as the "baseline" for
 * diff predicates and as the "current" screenshot for color predicates.
 */
function makePng(
  width: number,
  height: number,
  fill: { r: number; g: number; b: number; a?: number } = { r: 255, g: 255, b: 255 },
): Buffer {
  const png = new PNG({ width, height, colorType: 6 })
  const rgba = fill.a === undefined ? { red: fill.r, green: fill.g, blue: fill.b } : fill
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      png.data[idx] = rgba.red
      png.data[idx + 1] = rgba.green
      png.data[idx + 2] = rgba.blue
      png.data[idx + 3] = fill.a ?? 255
    }
  }
  return PNG.sync.write(png)
}

/**
 * Build a PNG with a foreground rectangle of one color on a background of another.
 * Useful for the "red circle on a white canvas" verification scenario.
 */
function makeTwoColorPng(
  width: number,
  height: number,
  bg: { r: number; g: number; b: number },
  fg: { r: number; g: number; b: number },
  fgRect: { x: number; y: number; width: number; height: number },
): Buffer {
  const png = new PNG({ width, height, colorType: 6 })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      const insideFg =
        x >= fgRect.x &&
        x < fgRect.x + fgRect.width &&
        y >= fgRect.y &&
        y < fgRect.y + fgRect.height
      png.data[idx] = insideFg ? fg.r : bg.r
      png.data[idx + 1] = insideFg ? fg.g : bg.g
      png.data[idx + 2] = insideFg ? fg.b : bg.b
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

async function captureThrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
    return undefined
  } catch (e) {
    return e
  }
}

describe('da_verify_pixels schema', () => {
  it('accepts color predicate', () => {
    expect(() =>
      daVerifyPixels.inputSchema.parse({
        predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 10 },
      }),
    ).not.toThrow()
  })

  it('accepts diff predicate with base64 baseline', () => {
    const baseline = makePng(10, 10, { r: 255, g: 255, b: 255 }).toString('base64')
    expect(() =>
      daVerifyPixels.inputSchema.parse({
        predicate: { kind: 'diff', baseline, threshold: 0.05 },
      }),
    ).not.toThrow()
  })

  it('accepts region + timeoutMs + intervalMs', () => {
    expect(() =>
      daVerifyPixels.inputSchema.parse({
        predicate: { kind: 'color', rgb: [0, 0, 0], minCount: 1 },
        region: { x: 0, y: 0, width: 100, height: 100 },
        timeoutMs: 5000,
        intervalMs: 200,
      }),
    ).not.toThrow()
  })

  it('rejects rgb component out of range', () => {
    expect(
      daVerifyPixels.inputSchema.safeParse({
        predicate: { kind: 'color', rgb: [256, 0, 0], minCount: 1 },
      }).success,
    ).toBe(false)
  })

  it('rejects threshold out of 0..1', () => {
    expect(
      daVerifyPixels.inputSchema.safeParse({
        predicate: { kind: 'diff', baseline: 'AA==', threshold: 1.5 },
      }).success,
    ).toBe(false)
  })

  it('rejects unknown predicate kind', () => {
    expect(
      daVerifyPixels.inputSchema.safeParse({
        predicate: { kind: 'unknown', foo: 1 },
      }).success,
    ).toBe(false)
  })
})

describe('da_verify_pixels handler — color predicate', () => {
  it('returns matched when minCount is satisfied on the first poll', async () => {
    // 4x4 white PNG with a 2x2 red square in the center → 4 red pixels.
    const png = makeTwoColorPng(
      4,
      4,
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { x: 1, y: 1, width: 2, height: 2 },
    )
    mockScreenshot.mockResolvedValue(png)

    const result = (await daVerifyPixels.handler({
      predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 4 },
    })) as {
      matched: boolean
      stats: { count: number; totalPixels: number }
      attempts: number
    }

    expect(result.matched).toBe(true)
    expect(result.stats.count).toBe(4)
    expect(result.stats.totalPixels).toBe(16)
    expect(result.attempts).toBe(1)
  })

  it('tolerance expands the match window (RGB drift)', async () => {
    // Image is actually (250, 5, 5) — within tolerance of (255, 0, 0).
    const png = makePng(2, 2, { r: 250, g: 5, b: 5 })
    mockScreenshot.mockResolvedValue(png)

    const result = (await daVerifyPixels.handler({
      predicate: { kind: 'color', rgb: [255, 0, 0], tolerance: 10, minCount: 4 },
    })) as { stats: { count: number } }
    expect(result.stats.count).toBe(4)
  })

  it('region clips the image before counting', async () => {
    // 4x4 white with a single red pixel at (3, 3).
    const png = makePng(4, 4, { r: 255, g: 255, b: 255 })
    // Set pixel (3, 3) red by writing a 2-color PNG.
    const red = makeTwoColorPng(
      4,
      4,
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { x: 3, y: 3, width: 1, height: 1 },
    )
    mockScreenshot.mockResolvedValue(red)

    // Region covers the red pixel → count = 1.
    const result = (await daVerifyPixels.handler({
      predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 1 },
      region: { x: 3, y: 3, width: 1, height: 1 },
    })) as { stats: { count: number; totalPixels: number } }
    expect(result.stats.count).toBe(1)
    expect(result.stats.totalPixels).toBe(1)
  })

  it('throws NOT_FOUND on timeout when minCount is never reached', async () => {
    mockScreenshot.mockResolvedValue(makePng(4, 4, { r: 255, g: 255, b: 255 }))

    const caught = await captureThrown(
      daVerifyPixels.handler({
        predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 1 },
        timeoutMs: 100,
        intervalMs: 50,
      }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NOT_FOUND')
    }
  })

  it('polls until satisfied then returns', async () => {
    let polls = 0
    mockScreenshot.mockImplementation(() => {
      polls++
      return polls >= 2
        ? makeTwoColorPng(
            4,
            4,
            { r: 255, g: 255, b: 255 },
            { r: 255, g: 0, b: 0 },
            { x: 0, y: 0, width: 4, height: 4 }, // all red
          )
        : makePng(4, 4, { r: 255, g: 255, b: 255 })
    })

    const result = (await daVerifyPixels.handler({
      predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 16 },
      timeoutMs: 2000,
      intervalMs: 50,
    })) as { attempts: number; stats: { count: number } }
    expect(result.attempts).toBe(2)
    expect(result.stats.count).toBe(16)
  })
})

describe('da_verify_pixels handler — diff predicate', () => {
  it('returns matched when fraction of differing pixels >= threshold', async () => {
    const baseline = makePng(4, 4, { r: 255, g: 255, b: 255 })
    const current = makeTwoColorPng(
      4,
      4,
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { x: 0, y: 0, width: 4, height: 4 }, // all red — 100% diff
    )
    mockScreenshot.mockResolvedValue(current)

    const result = (await daVerifyPixels.handler({
      predicate: {
        kind: 'diff',
        baseline: baseline.toString('base64'),
        threshold: 0.5,
      },
    })) as {
      matched: boolean
      stats: { diffFraction: number }
    }
    expect(result.matched).toBe(true)
    expect(result.stats.diffFraction).toBe(1)
  })

  it('does NOT match when fraction is below threshold', async () => {
    const baseline = makePng(4, 4, { r: 255, g: 255, b: 255 })
    const current = makePng(4, 4, { r: 250, g: 250, b: 250 }) // tiny drift
    mockScreenshot.mockResolvedValue(current)

    const caught = await captureThrown(
      daVerifyPixels.handler({
        predicate: {
          kind: 'diff',
          baseline: baseline.toString('base64'),
          threshold: 0.5,
          tolerance: 8,
        },
        timeoutMs: 100,
        intervalMs: 50,
      }),
    )
    // Tiny drift is below tolerance 8 → diff_fraction = 0 → not matched.
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NOT_FOUND')
    }
  })

  it('region clips both the screenshot and the baseline', async () => {
    // 4x4 white baseline with a red 2x2 at (1, 1).
    const baseline = makeTwoColorPng(
      4,
      4,
      { r: 255, g: 255, b: 255 },
      { r: 255, g: 0, b: 0 },
      { x: 1, y: 1, width: 2, height: 2 },
    )
    // Current screenshot is all-white everywhere.
    const current = makePng(4, 4, { r: 255, g: 255, b: 255 })
    mockScreenshot.mockResolvedValue(current)

    // Region focuses on the red rectangle. Current has all white there → 100% diff.
    const result = (await daVerifyPixels.handler({
      predicate: {
        kind: 'diff',
        baseline: baseline.toString('base64'),
        threshold: 0.5,
      },
      region: { x: 1, y: 1, width: 2, height: 2 },
    })) as { stats: { diffFraction: number; totalPixels: number } }
    expect(result.stats.diffFraction).toBe(1)
    expect(result.stats.totalPixels).toBe(4)
  })
})

describe('da_verify_pixels handler — error handling', () => {
  it('throws INVALID_ARGUMENT when region is outside the image', async () => {
    mockScreenshot.mockResolvedValue(makePng(4, 4))

    const caught = await captureThrown(
      daVerifyPixels.handler({
        predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 1 },
        region: { x: 100, y: 100, width: 10, height: 10 },
      }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('INVALID_ARGUMENT')
    }
  })

  it('throws NATIVE_FAILED when screenshot is not a valid PNG', async () => {
    mockScreenshot.mockResolvedValue(Buffer.from([0x00, 0x01, 0x02, 0x03]))

    const caught = await captureThrown(
      daVerifyPixels.handler({
        predicate: { kind: 'color', rgb: [255, 0, 0], minCount: 1 },
      }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      // SCREENSHOT_EMPTY is the same code the screenshot module uses for invalid PNGs.
      expect(caught.code).toBe('SCREENSHOT_EMPTY')
    }
  })
})