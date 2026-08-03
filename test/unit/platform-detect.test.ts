import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  detectOs,
  detectDisplayServer,
  detectPlatform,
  probeTools,
  assertPlatformSupported,
} from '../../src/platform/detect.js'
import { DaMcpError } from '../../src/errors.js'
import type { AvailableTools, PlatformInfo } from '../../src/platform/types.js'

function emptyTools(): AvailableTools {
  return {
    xdotool: false,
    ydotool: false,
    wtype: false,
    screenshotDesktop: false,
    robotjs: false,
    tesseract: false,
    scrot: false,
    grim: false,
    screencapture: false,
  }
}

// ---- env snapshot/restore helpers ---------------------------------------

const TRACKED_ENV_KEYS = ['DISPLAY', 'WAYLAND_DISPLAY', 'DA_MCP_TEST_MODE'] as const

function snapshotEnv(): Record<(typeof TRACKED_ENV_KEYS)[number], string | undefined> {
  return {
    DISPLAY: process.env['DISPLAY'],
    WAYLAND_DISPLAY: process.env['WAYLAND_DISPLAY'],
    DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'],
  }
}

function restoreEnv(snap: Record<(typeof TRACKED_ENV_KEYS)[number], string | undefined>): void {
  for (const key of TRACKED_ENV_KEYS) {
    if (snap[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = snap[key]
    }
  }
}

function setOnlyEnv(values: Partial<Record<(typeof TRACKED_ENV_KEYS)[number], string>>): void {
  for (const key of TRACKED_ENV_KEYS) {
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }
}

function expectAllBooleanTools(tools: AvailableTools): void {
  const keys: readonly (keyof AvailableTools)[] = [
    'xdotool',
    'ydotool',
    'wtype',
    'screenshotDesktop',
    'robotjs',
    'tesseract',
    'scrot',
    'grim',
    'screencapture',
  ]
  for (const k of keys) {
    expect(typeof tools[k]).toBe('boolean')
  }
}

// ---- detectOs ------------------------------------------------------------

describe('detectOs', () => {
  it('maps linux → linux', () => {
    expect(detectOs('linux')).toBe('linux')
  })

  it('maps darwin → darwin', () => {
    expect(detectOs('darwin')).toBe('darwin')
  })

  it('maps win32 → win32', () => {
    expect(detectOs('win32')).toBe('win32')
  })

  it('maps unrecognized platforms → unknown', () => {
    expect(detectOs('freebsd' as NodeJS.Platform)).toBe('unknown')
    expect(detectOs('openbsd' as NodeJS.Platform)).toBe('unknown')
    expect(detectOs('aix' as NodeJS.Platform)).toBe('unknown')
  })
})

// ---- detectDisplayServer -------------------------------------------------

describe('detectDisplayServer', () => {
  it('linux + WAYLAND_DISPLAY set → wayland with that value', () => {
    expect(detectDisplayServer('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual({
      display: 'wayland',
      displayEnv: 'wayland-0',
    })
  })

  it('linux + DISPLAY set → x11 with that value', () => {
    expect(detectDisplayServer('linux', { DISPLAY: ':0' })).toEqual({
      display: 'x11',
      displayEnv: ':0',
    })
  })

  it('linux + both envs set → wayland wins (Wayland preference)', () => {
    expect(
      detectDisplayServer('linux', { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-1' }),
    ).toEqual({ display: 'wayland', displayEnv: 'wayland-1' })
  })

  it('linux + neither env → unknown, displayEnv null', () => {
    expect(detectDisplayServer('linux', {})).toEqual({
      display: 'unknown',
      displayEnv: null,
    })
  })

  it('linux + empty-string env values → unknown (treated as unset)', () => {
    expect(detectDisplayServer('linux', { DISPLAY: '', WAYLAND_DISPLAY: '' })).toEqual({
      display: 'unknown',
      displayEnv: null,
    })
  })

  it('darwin → native regardless of DISPLAY/WAYLAND_DISPLAY', () => {
    expect(detectDisplayServer('darwin', { DISPLAY: ':99' })).toEqual({
      display: 'native',
      displayEnv: null,
    })
    expect(detectDisplayServer('darwin', {})).toEqual({
      display: 'native',
      displayEnv: null,
    })
  })

  it('win32 → native regardless of DISPLAY/WAYLAND_DISPLAY', () => {
    expect(detectDisplayServer('win32', { WAYLAND_DISPLAY: 'wayland-0' })).toEqual({
      display: 'native',
      displayEnv: null,
    })
  })

  it('unknown OS → unknown', () => {
    expect(detectDisplayServer('unknown', { DISPLAY: ':0' })).toEqual({
      display: 'unknown',
      displayEnv: null,
    })
  })
})

// ---- probeTools ----------------------------------------------------------

describe('probeTools', () => {
  it('mock=true → every tool false', () => {
    const tools = probeTools(true)
    expectAllBooleanTools(tools)
    for (const v of Object.values(tools)) {
      expect(v).toBe(false)
    }
  })

  it('mock=false → returns real PATH probe with correct shape', () => {
    const tools = probeTools(false)
    expectAllBooleanTools(tools)
    // On this test host, xdotool and tesseract are installed; if your
    // environment differs, these assertions can be relaxed — they're
    // guarded so they pass on PATH-less hosts too.
    expect(tools.xdotool).toBe(true)
    expect(tools.tesseract).toBe(true)
    // screenshotDesktop is a node_modules native binary, NOT on PATH —
    // probeTools intentionally reports it false (detection is by another
    // mechanism in the platform adapter layer).
    expect(tools.screenshotDesktop).toBe(false)
  })
})

// ---- detectPlatform (end-to-end) -----------------------------------------

describe('detectPlatform (e2e)', () => {
  let envSnap: Record<(typeof TRACKED_ENV_KEYS)[number], string | undefined>

  beforeEach(() => {
    envSnap = snapshotEnv()
  })

  afterEach(() => {
    restoreEnv(envSnap)
  })

  it('reflects the actual current process.platform and arch', () => {
    setOnlyEnv({})
    const info = detectPlatform()
    expect(info.os).toBe(detectOs()) // mirrors whatever process.platform is
    expect(info.arch).toBe(process.arch)
    expectAllBooleanTools(info.tools)
  })

  it('linux + DISPLAY only → x11 + that DISPLAY value', () => {
    setOnlyEnv({ DISPLAY: ':99' })
    const info = detectPlatform()
    expect(info.os).toBe('linux')
    expect(info.display).toBe('x11')
    expect(info.displayEnv).toBe(':99')
  })

  it('linux + WAYLAND_DISPLAY only → wayland + that value', () => {
    setOnlyEnv({ WAYLAND_DISPLAY: 'wayland-1' })
    const info = detectPlatform()
    expect(info.os).toBe('linux')
    expect(info.display).toBe('wayland')
    expect(info.displayEnv).toBe('wayland-1')
  })

  it('linux + both DISPLAY and WAYLAND_DISPLAY set → wayland wins', () => {
    setOnlyEnv({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' })
    const info = detectPlatform()
    expect(info.os).toBe('linux')
    expect(info.display).toBe('wayland')
    expect(info.displayEnv).toBe('wayland-0')
  })

  it('linux + no display env → display=unknown, displayEnv=null', () => {
    setOnlyEnv({})
    const info = detectPlatform()
    expect(info.os).toBe('linux')
    expect(info.display).toBe('unknown')
    expect(info.displayEnv).toBeNull()
  })

  it('DA_MCP_TEST_MODE=mock → all tools false even when PATH has them', () => {
    setOnlyEnv({ DISPLAY: ':0', DA_MCP_TEST_MODE: 'mock' })
    const info = detectPlatform()
    expect(info.os).toBe('linux')
    expect(info.display).toBe('x11')
    for (const v of Object.values(info.tools)) {
      expect(v).toBe(false)
    }
  })

  it('detectPlatform is pure: repeated calls return equivalent results', () => {
    setOnlyEnv({ DISPLAY: ':0' })
    const a = detectPlatform()
    const b = detectPlatform()
    expect(a).toEqual(b)
  })
})

// ---- assertPlatformSupported (PLATFORM_INIT_FAILED) ---------------------

describe('assertPlatformSupported', () => {
  it('throws DaMcpError PLATFORM_INIT_FAILED when info.os is unknown', () => {
    const info: PlatformInfo = {
      os: 'unknown',
      display: 'unknown',
      displayEnv: null,
      arch: 'x64',
      tools: emptyTools(),
    }
    expect(() => assertPlatformSupported(info)).toThrow(DaMcpError)
    try {
      assertPlatformSupported(info)
    } catch (err) {
      expect(DaMcpError.is(err)).toBe(true)
      if (DaMcpError.is(err)) {
        expect(err.code).toBe('PLATFORM_INIT_FAILED')
      }
    }
  })

  it('does not throw for a recognised OS (linux)', () => {
    const info: PlatformInfo = {
      os: 'linux',
      display: 'x11',
      displayEnv: ':0',
      arch: 'x64',
      tools: emptyTools(),
    }
    expect(() => assertPlatformSupported(info)).not.toThrow()
  })

  it('does not throw for win32 (windows is supported via the CLI fallback)', () => {
    const info: PlatformInfo = {
      os: 'win32',
      display: 'native',
      displayEnv: null,
      arch: 'x64',
      tools: emptyTools(),
    }
    expect(() => assertPlatformSupported(info)).not.toThrow()
  })

  it('does not throw for darwin', () => {
    const info: PlatformInfo = {
      os: 'darwin',
      display: 'native',
      displayEnv: null,
      arch: 'arm64',
      tools: emptyTools(),
    }
    expect(() => assertPlatformSupported(info)).not.toThrow()
  })
})