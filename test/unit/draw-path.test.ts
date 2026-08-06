/**
 * Unit tests for src/tools/draw-path.ts.
 *
 * The tool composes primitives from src/input/ (mouseMove / mouseDown /
 * mouseUp / keyDown / keyUp). We mock that module so we can observe call
 * order and inspect arguments without invoking native code. validateCoords
 * is left real (imported directly from src/input/routing.js) so the
 * OUT_OF_BOUNDS test exercises the real validator.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { DaMcpError } from '../../src/errors.js'

vi.mock('../../src/input/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/input/index.js')>(
    '../../src/input/index.js',
  )
  return {
    ...actual,
    mouseMove: vi.fn(),
    mouseDown: vi.fn(),
    mouseUp: vi.fn(),
    keyDown: vi.fn(),
    keyUp: vi.fn(),
  }
})

import {
  mouseMove,
  mouseDown,
  mouseUp,
  keyDown,
  keyUp,
} from '../../src/input/index.js'
import { daDrawPath } from '../../src/tools/draw-path.js'

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

const MOCKED_INPUT_FNS = [mouseMove, mouseDown, mouseUp, keyDown, keyUp] as const

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  for (const fn of MOCKED_INPUT_FNS) {
    vi.mocked(fn).mockReset()
    vi.mocked(fn).mockResolvedValue(undefined)
  }
})

afterEach(() => {
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.restoreAllMocks()
})

function wireTrace(): { trace: string[] } {
  const trace: string[] = []
  vi.mocked(mouseMove).mockImplementation(async () => {
    trace.push('mouseMove')
  })
  vi.mocked(mouseDown).mockImplementation(async () => {
    trace.push('mouseDown')
  })
  vi.mocked(mouseUp).mockImplementation(async () => {
    trace.push('mouseUp')
  })
  vi.mocked(keyDown).mockImplementation(async () => {
    trace.push('keyDown')
  })
  vi.mocked(keyUp).mockImplementation(async () => {
    trace.push('keyUp')
  })
  return { trace }
}

async function captureThrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
    return undefined
  } catch (e) {
    return e
  }
}

function assertCode(caught: unknown, code: string): void {
  expect(DaMcpError.is(caught)).toBe(true)
  if (DaMcpError.is(caught)) {
    expect(caught.code).toBe(code)
  }
}

describe('da_draw_path', () => {
  it('2-point path calls mouseMove x2 + mouseDown + mouseUp in order', async () => {
    const { trace } = wireTrace()
    const result = await daDrawPath.handler({ points: [[10, 20], [30, 40]] })
    expect(trace).toEqual(['mouseMove', 'mouseDown', 'mouseMove', 'mouseUp'])
    expect(mouseMove.mock.calls[0]).toEqual([10, 20])
    expect(mouseMove.mock.calls[1]).toEqual([30, 40, {}])
    expect(mouseDown).toHaveBeenCalledWith('left')
    expect(mouseUp).toHaveBeenCalledWith('left')
    expect(result).toEqual({ traced: 2, button: 'left', modifiers: [] })
  })

  it('5-point path calls mouseMove per point (5 total) + down + up', async () => {
    const { trace } = wireTrace()
    const result = await daDrawPath.handler({
      points: [[10, 20], [30, 40], [50, 60], [70, 80], [90, 100]],
    })
    expect(trace).toEqual([
      'mouseMove',
      'mouseDown',
      'mouseMove',
      'mouseMove',
      'mouseMove',
      'mouseMove',
      'mouseUp',
    ])
    expect(mouseMove).toHaveBeenCalledTimes(5)
    expect(mouseDown).toHaveBeenCalledTimes(1)
    expect(mouseUp).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ traced: 5, button: 'left', modifiers: [] })
  })

  it('modifiers=[shift]: keyDown before mouseDown, keyUp after mouseUp', async () => {
    const { trace } = wireTrace()
    await daDrawPath.handler({
      points: [[10, 20], [30, 40]],
      modifiers: ['shift'],
    })
    const kdIdx = trace.indexOf('keyDown')
    const mdIdx = trace.indexOf('mouseDown')
    const muIdx = trace.indexOf('mouseUp')
    const kuIdx = trace.indexOf('keyUp')
    expect(kdIdx).toBeGreaterThanOrEqual(0)
    expect(kdIdx).toBeLessThan(mdIdx)
    expect(kuIdx).toBeGreaterThan(muIdx)
    expect(keyDown).toHaveBeenCalledWith('shift')
    expect(keyUp).toHaveBeenCalledWith('shift')
  })

  it('multiple modifiers: keyDown in declaration order, keyUp in reverse order', async () => {
    const order: string[] = []
    vi.mocked(keyDown).mockImplementation(async (m: string) => {
      order.push(`down:${m}`)
    })
    vi.mocked(keyUp).mockImplementation(async (m: string) => {
      order.push(`up:${m}`)
    })
    await daDrawPath.handler({
      points: [[0, 0], [10, 10]],
      modifiers: ['shift', 'ctrl', 'alt'],
    })
    expect(order).toEqual([
      'down:shift',
      'down:ctrl',
      'down:alt',
      'up:alt',
      'up:ctrl',
      'up:shift',
    ])
  })

  it('mouseDown throws → keyUp still runs (modifier cleanup via try/finally)', async () => {
    const order: string[] = []
    vi.mocked(keyDown).mockImplementation(async (m: string) => {
      order.push(`down:${m}`)
    })
    vi.mocked(mouseDown).mockImplementation(async () => {
      order.push('mouseDown')
      throw new DaMcpError('NATIVE_FAILED', 'simulated mouseDown failure')
    })
    vi.mocked(mouseUp).mockImplementation(async () => {
      order.push('mouseUp')
    })
    vi.mocked(keyUp).mockImplementation(async (m: string) => {
      order.push(`up:${m}`)
    })
    const caught = await captureThrown(
      daDrawPath.handler({
        points: [[0, 0], [10, 10]],
        modifiers: ['shift', 'ctrl'],
      }),
    )
    assertCode(caught, 'NATIVE_FAILED')
    expect(order).toEqual([
      'down:shift',
      'down:ctrl',
      'mouseDown',
      'up:ctrl',
      'up:shift',
    ])
    expect(mouseUp).not.toHaveBeenCalled()
  })

  it('out-of-bounds point throws OUT_OF_BOUNDS before any mouse/key calls', async () => {
    const { trace } = wireTrace()
    const caught = await captureThrown(
      daDrawPath.handler({ points: [[10, 20], [50, 99_999]] }),
    )
    assertCode(caught, 'OUT_OF_BOUNDS')
    expect(trace).toEqual([])
    expect(mouseMove).not.toHaveBeenCalled()
    expect(mouseDown).not.toHaveBeenCalled()
    expect(mouseUp).not.toHaveBeenCalled()
    expect(keyDown).not.toHaveBeenCalled()
    expect(keyUp).not.toHaveBeenCalled()
  })

  it('button="right" is passed to mouseDown / mouseUp', async () => {
    const { trace } = wireTrace()
    const result = await daDrawPath.handler({
      points: [[0, 0], [1, 1]],
      button: 'right',
    })
    expect(trace).toEqual(['mouseMove', 'mouseDown', 'mouseMove', 'mouseUp'])
    expect(mouseDown).toHaveBeenCalledWith('right')
    expect(mouseUp).toHaveBeenCalledWith('right')
    expect(result).toEqual({ traced: 2, button: 'right', modifiers: [] })
  })

  it('durationMs is forwarded to mouseMove on subsequent points, not the first', async () => {
    wireTrace()
    await daDrawPath.handler({
      points: [[10, 20], [30, 40], [50, 60]],
      durationMs: 25,
    })
    expect(mouseMove.mock.calls[0]).toEqual([10, 20])
    expect(mouseMove.mock.calls[1]).toEqual([30, 40, { durationMs: 25 }])
    expect(mouseMove.mock.calls[2]).toEqual([50, 60, { durationMs: 25 }])
  })
})
