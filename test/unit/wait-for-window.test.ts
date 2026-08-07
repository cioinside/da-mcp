/**
 * Unit tests for da_wait_for_window.
 *
 * Mocks `listWindows` from src/window/index.js so the handler can be
 * exercised against deterministic window fixtures without touching the
 * OS-level backend.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest'

import { DaMcpError } from '../../src/errors.js'
import type { WindowInfo } from '../../src/window/types.js'

const mockListWindows: Mock<[], WindowInfo[]> = vi.fn()

vi.mock('../../src/window/index.js', () => ({
  listWindows: () => mockListWindows(),
}))

const { daWaitForWindow } = await import('../../src/tools/wait-for-window.js')

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  mockListWindows.mockReset()
})

afterEach(() => {
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function window(title: string, hwnd = 0x100001): WindowInfo {
  return {
    hwnd,
    pid: 4242,
    title,
    rect: { x: 0, y: 0, width: 800, height: 600 },
    isVisible: true,
  }
}

async function captureThrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
    return undefined
  } catch (e) {
    return e
  }
}

describe('da_wait_for_window schema', () => {
  it('accepts canonical input', () => {
    expect(() =>
      daWaitForWindow.inputSchema.parse({ title: 'Notepad' }),
    ).not.toThrow()
  })

  it('rejects empty title', () => {
    expect(daWaitForWindow.inputSchema.safeParse({ title: '' }).success).toBe(false)
  })

  it('accepts match + timeoutMs + intervalMs', () => {
    expect(() =>
      daWaitForWindow.inputSchema.parse({
        title: 'Paint',
        match: 'regex',
        timeoutMs: 1000,
        intervalMs: 100,
      }),
    ).not.toThrow()
  })

  it('rejects timeoutMs above the 60000ms cap', () => {
    expect(
      daWaitForWindow.inputSchema.safeParse({ title: 'X', timeoutMs: 120000 }).success,
    ).toBe(false)
  })

  it('rejects intervalMs below the 50ms floor', () => {
    expect(
      daWaitForWindow.inputSchema.safeParse({ title: 'X', intervalMs: 10 }).success,
    ).toBe(false)
  })
})

describe('da_wait_for_window handler', () => {
  it('returns the first matching window immediately when present', async () => {
    mockListWindows.mockReturnValueOnce([
      window('Untitled - Notepad'),
      window('Untitled - Paint'),
    ])

    const result = (await daWaitForWindow.handler({
      title: 'Paint',
    })) as { found: boolean; window: WindowInfo; waitedMs: number; attempts: number }

    expect(result.found).toBe(true)
    expect(result.window.title).toBe('Untitled - Paint')
    expect(result.attempts).toBe(1)
    expect(result.waitedMs).toBeGreaterThanOrEqual(0)
  })

  it('substring match is case-insensitive', async () => {
    mockListWindows.mockReturnValueOnce([window('UNTITLED - PAINT')])
    const result = (await daWaitForWindow.handler({
      title: 'paint',
      match: 'substring',
    })) as { window: WindowInfo }
    expect(result.window.title).toBe('UNTITLED - PAINT')
  })

  it('exact match requires full-string equality (case-insensitive)', async () => {
    mockListWindows.mockReturnValue([window('Untitled - Paint')])
    const caught = await captureThrown(
      daWaitForWindow.handler({
        title: 'Paint',
        match: 'exact',
        timeoutMs: 100,
        intervalMs: 50,
      }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NOT_FOUND')
    }
  })

  it('exact match succeeds on full equality', async () => {
    mockListWindows.mockReturnValueOnce([window('Paint')])
    const result = (await daWaitForWindow.handler({
      title: 'paint',
      match: 'exact',
    })) as { found: boolean }
    expect(result.found).toBe(true)
  })

  it('regex match with a valid pattern', async () => {
    mockListWindows.mockReturnValueOnce([window('Untitled - Notepad')])
    const result = (await daWaitForWindow.handler({
      title: 'Notepad$',
      match: 'regex',
    })) as { found: boolean }
    expect(result.found).toBe(true)
  })

  it('polls until match appears, then returns', async () => {
    let polls = 0
    mockListWindows.mockImplementation(() => {
      polls++
      // Window appears on the 3rd poll.
      return polls >= 3 ? [window('Calculator')] : []
    })

    const result = (await daWaitForWindow.handler({
      title: 'Calc',
      timeoutMs: 2000,
      intervalMs: 50,
    })) as { window: WindowInfo; attempts: number }

    expect(result.window.title).toBe('Calculator')
    expect(result.attempts).toBe(3)
  })

  it('throws NOT_FOUND on timeout', async () => {
    mockListWindows.mockReturnValue([]) // never matches

    const caught = await captureThrown(
      daWaitForWindow.handler({ title: 'Never', timeoutMs: 100, intervalMs: 50 }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NOT_FOUND')
      expect(caught.message).toContain('Never')
    }
  })
})