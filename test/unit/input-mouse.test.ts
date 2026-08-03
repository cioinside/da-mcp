/**
 * Unit tests for src/input/mouse.ts — focused on getMousePosition().
 *
 * Unlike the existing test/unit/input.test.ts which exercises mouse operations
 * under DA_MCP_TEST_MODE=mock (the mock short-circuits all native calls), this
 * file drives getMousePosition() under DA_MCP_TEST_MODE=real with three layers
 * of mocking:
 *   - ../../src/platform/detect.js   → forced to a per-test PlatformInfo
 *   - robotjs                         → getMousePos stub
 *   - node:child_process              → spawnSync stub returning canned stdout
 *
 * Coverage:
 *   1. Linux X11: parses X=NNN / Y=NNN out of `xdotool getmouselocation --shell`.
 *   2. macOS:     returns robotjs.getMousePos() directly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import * as cp from 'node:child_process'
import * as robotjs from 'robotjs'

import { initConfig, resetConfig } from '../../src/config.js'
import { detectPlatform } from '../../src/platform/detect.js'
import { getMousePosition } from '../../src/input/mouse.js'
import type { PlatformInfo } from '../../src/platform/types.js'

vi.mock('../../src/platform/detect.js', () => ({
  detectPlatform: vi.fn(),
}))

vi.mock('robotjs', () => {
  const fake = {
    moveMouse: vi.fn(),
    getMousePos: vi.fn(),
    mouseClick: vi.fn(),
    mouseToggle: vi.fn(),
    scrollMouse: vi.fn(),
  }
  return { ...fake, default: fake }
})

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
      robotjs: false,
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
      robotjs: true,
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
  vi.mocked(robotjs.getMousePos).mockReset()
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
  // Test 1: Linux X11 path — spawnSync is mocked to return xdotool's --shell output.
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

  // Test 2: macOS path — robotjs.getMousePos() returns integer coords directly.
  it('returns robotjs coords on macOS', async () => {
    vi.mocked(detectPlatform).mockReturnValue(platformMac())
    vi.mocked(robotjs.getMousePos).mockReturnValue({ x: 50, y: 60 })
    const pos = await getMousePosition()
    expect(pos).toEqual({ x: 50, y: 60 })
    expect(robotjs.getMousePos).toHaveBeenCalledTimes(1)
  })
})
