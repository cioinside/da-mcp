/**
 * Unit tests for src/input/mouse.ts — focused on getMousePosition().
 *
 * Unlike the existing test/unit/input.test.ts which exercises mouse operations
 * under DA_MCP_TEST_MODE=mock (the mock short-circuits all native calls), this
 * file drives getMousePosition() under DA_MCP_TEST_MODE=real with three layers
 * of mocking:
 *   - ../../src/platform/detect.js   → forced to a per-test PlatformInfo
 *   - @nut-tree-fork/nut-js           → mouse.getPosition stub
 *   - node:child_process              → spawnSync stub returning canned stdout
 *
 * Coverage:
 *   1. Linux X11: parses X=NNN / Y=NNN out of `xdotool getmouselocation --shell`.
 *   2. macOS:     returns mouse.getPosition() directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import * as cp from 'node:child_process'
import { mouse } from '@nut-tree-fork/nut-js'

import { initConfig, resetConfig } from '../../src/config.js'
import { detectPlatform } from '../../src/platform/detect.js'
import { getMousePosition } from '../../src/input/mouse.js'
import type { PlatformInfo } from '../../src/platform/types.js'

vi.mock('../../src/platform/detect.js', () => ({
  detectPlatform: vi.fn(),
}))

vi.mock('@nut-tree-fork/nut-js', () => ({
  mouse: {
    setPosition: vi.fn(),
    getPosition: vi.fn(),
    click: vi.fn(),
    doubleClick: vi.fn(),
    pressButton: vi.fn(),
    releaseButton: vi.fn(),
    scrollDown: vi.fn(),
    scrollUp: vi.fn(),
    scrollLeft: vi.fn(),
    scrollRight: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  default: { spawnSync: vi.fn() },
}))

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

function platformX11(): PlatformInfo {
  return {
    os: 'linux',
    display: 'x11',
    displayEnv: ':0',
    arch: 'x64',
    tools: {
      xdotool: true,
      ydotool: false,
      wtype: false,
      screenshotDesktop: false,
      nutjs: false,
      tesseract: false,
      scrot: false,
      grim: false,
      screencapture: false,
    },
  }
}

function platformMac(): PlatformInfo {
  return {
    os: 'darwin',
    display: 'native',
    displayEnv: null,
    arch: 'x64',
    tools: {
      xdotool: false,
      ydotool: false,
      wtype: false,
      screenshotDesktop: false,
      nutjs: true,
      tesseract: false,
      scrot: false,
      grim: false,
      screencapture: false,
    },
  }
}

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'real'
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'real' })
  vi.mocked(cp.spawnSync).mockReset()
  vi.mocked(detectPlatform).mockReset()
  vi.mocked(mouse.getPosition).mockReset()
})

afterEach(() => {
  resetConfig()
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  vi.restoreAllMocks()
})

describe('getMousePosition', () => {
  it('parses X/Y from xdotool getmouselocation --shell on Linux X11', async () => {
    vi.mocked(detectPlatform).mockReturnValue(platformX11())
    const stdout = Buffer.from('X=100\nY=200\nSCREEN=0\nWINDOW=12345\n')
    vi.mocked(cp.spawnSync).mockReturnValue({
      pid: 1,
      output: [null, stdout, null],
      stdout,
      stderr: Buffer.from(''),
      status: 0,
      signal: null,
    } as cp.SpawnSyncReturns<Buffer>)
    const pos = await getMousePosition()
    expect(pos).toEqual({ x: 100, y: 200 })
    expect(cp.spawnSync).toHaveBeenCalledWith(
      'xdotool',
      ['getmouselocation', '--shell'],
      expect.objectContaining({ shell: false }),
    )
  })

  it('returns nut.js mouse coords on macOS', async () => {
    vi.mocked(detectPlatform).mockReturnValue(platformMac())
    vi.mocked(mouse.getPosition).mockResolvedValue({ x: 50, y: 60 })
    const pos = await getMousePosition()
    expect(pos).toEqual({ x: 50, y: 60 })
    expect(mouse.getPosition).toHaveBeenCalledTimes(1)
  })
})