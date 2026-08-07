import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { DaMcpError } from '../../src/errors.js'
import {
  screenshot,
  captureScreenshot,
  listDisplays,
  isMockMode,
  checkPngMagic,
  validatePngBuffer,
} from '../../src/screenshot/index.js'
import { isPermissionError } from '../../src/screenshot/backends.js'

// ---- env snapshot/restore -----------------------------------------------

const ENV_KEY = 'DA_MCP_TEST_MODE'

function snapshotEnv(): string | undefined {
  return process.env[ENV_KEY]
}

function restoreEnv(snap: string | undefined): void {
  if (snap === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = snap
}

describe('screenshot (mock mode)', () => {
  let envSnap: string | undefined

  beforeEach(() => {
    envSnap = snapshotEnv()
    process.env[ENV_KEY] = 'mock'
  })

  afterEach(() => {
    restoreEnv(envSnap)
  })

  // Test 1 — screenshot(null) returns a Buffer with valid PNG magic.
  it('screenshot(null) returns Buffer with valid PNG magic', async () => {
    expect(isMockMode()).toBe(true)
    const buf = await screenshot(null)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThanOrEqual(8)
    expect(checkPngMagic(buf)).toBe(true)
  })

  // Test 2 — screenshot(0) returns a Buffer for the synthetic primary display.
  it('screenshot(0) returns a Buffer for the synthetic primary display', async () => {
    const buf = await screenshot(0)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(checkPngMagic(buf)).toBe(true)
  })

  // Test 3 — displayId lookup rejects unknown ids with DISPLAY_NOT_FOUND.
  it('screenshot(99) throws DaMcpError with code DISPLAY_NOT_FOUND', async () => {
    await expect(screenshot(99)).rejects.toBeInstanceOf(DaMcpError)
    await expect(screenshot(99)).rejects.toMatchObject({ code: 'DISPLAY_NOT_FOUND' })
  })

  // Test 4 — listDisplays returns one primary 1920x1080 display in mock mode.
  it('listDisplays() returns exactly 1 primary DisplayInfo at 1920x1080', async () => {
    const displays = await listDisplays()
    expect(displays).toHaveLength(1)
    const d = displays[0]
    expect(d).toBeDefined()
    if (d === undefined) return
    expect(d.isPrimary).toBe(true)
    expect(d.bounds.width).toBe(1920)
    expect(d.bounds.height).toBe(1080)
    expect(d.bounds.x).toBe(0)
    expect(d.bounds.y).toBe(0)
    expect(d.scaleFactor).toBe(1)
    expect(d.rotation).toBe(0)
  })

  // Test 5 — captureScreenshot (the source-aware variant) reports source='mock'.
  it('captureScreenshot source is mock in mock mode', async () => {
    const result = await captureScreenshot(null)
    expect(result.source).toBe('mock')
    expect(result.displayId).toBe(0)
    expect(result.widthPx).toBe(1920)
    expect(result.heightPx).toBe(1080)
    expect(Buffer.isBuffer(result.buffer)).toBe(true)
    expect(checkPngMagic(result.buffer)).toBe(true)
  })

  // Test 6 — validatePngBuffer rejects non-PNG buffers.
  it('validatePngBuffer throws SCREENSHOT_EMPTY for non-PNG buffers', () => {
    expect(() => validatePngBuffer(Buffer.from([0, 0, 0]))).toThrow(DaMcpError)
    expect(() => validatePngBuffer(Buffer.from([0, 0, 0]))).toThrow(/SCREENSHOT_EMPTY|Screenshot/)
    expect(() => validatePngBuffer(Buffer.alloc(0))).toThrow(DaMcpError)
    expect(() => validatePngBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).not.toThrow()
  })

  // Bonus — displayId validation honours captureScreenshot's ScreenshotResult contract.
  it('captureScreenshot propagates displayId when one is supplied', async () => {
    const result = await captureScreenshot(0)
    expect(result.displayId).toBe(0)
  })
})

describe('isPermissionError (PERMISSION_DENIED detection)', () => {
  it('matches OS permission-gate phrases', () => {
    expect(isPermissionError('Screen recording permission denied')).toBe(true)
    expect(isPermissionError('ScreenCaptureKit requires user permission')).toBe(true)
    expect(isPermissionError('Access is denied on /dev/dri/renderD128')).toBe(true)
    expect(isPermissionError('permission to record screen was denied')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPermissionError('SCREEN RECORDING PERMISSION')).toBe(true)
    expect(isPermissionError('access IS DENIED')).toBe(true)
  })

  it('rejects unrelated failure messages', () => {
    expect(isPermissionError('display not found')).toBe(false)
    expect(isPermissionError('no such file or directory')).toBe(false)
    expect(isPermissionError('')).toBe(false)
  })
})

/**
 * Regression test for v1.0.3 bug #22.
 *
 * `screenshotDesktopBackend` previously returned a 0-byte Buffer silently
 * when the wrapper failed (TCC denial, session 0, etc.). The dispatcher
 * then returned that empty buffer to `validatePngBuffer`, which threw
 * opaque `SCREENSHOT_EMPTY` — no way for the user to know whether the
 * display was missing, capture was denied, or the backend itself was
 * broken.
 *
 * The fix: both `screenshotDesktopBackend` and `windowsCliBackend` now
 * throw `NATIVE_FAILED` with a descriptive message when the underlying
 * capture returns 0 bytes. The dispatcher in `dispatchCapture` already
 * falls through to the next backend on non-terminal errors, so a
 * failing screenshot-desktop naturally cascades to PowerShell BitBlt,
 * and a failing PowerShell surfaces a real error string instead of
 * `SCREENSHOT_EMPTY`.
 */
describe('screenshot backends — empty buffer must surface, not silently swallow (issue #22)', () => {
  it('screenshotDesktopBackend throws NATIVE_FAILED when capture returns 0 bytes', async () => {
    vi.doMock('screenshot-desktop', () => ({
      default: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    }))
    const { screenshotDesktopBackend } = await import('../../src/screenshot/backends.js')
    await expect(screenshotDesktopBackend(2)).rejects.toMatchObject({
      code: 'NATIVE_FAILED',
    })
    await expect(screenshotDesktopBackend(2)).rejects.toThrow(/displayId=2/)
    vi.doUnmock('screenshot-desktop')
  })

  it('screenshotDesktopBackend throws NATIVE_FAILED when capture returns null/undefined', async () => {
    vi.doMock('screenshot-desktop', () => ({
      default: vi.fn().mockResolvedValue(null),
    }))
    const { screenshotDesktopBackend } = await import('../../src/screenshot/backends.js')
    await expect(screenshotDesktopBackend(null)).rejects.toMatchObject({
      code: 'NATIVE_FAILED',
    })
    vi.doUnmock('screenshot-desktop')
  })

  it('screenshotDesktopBackend propagates a useful non-empty buffer', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    vi.doMock('screenshot-desktop', () => ({
      default: vi.fn().mockResolvedValue(png),
    }))
    const { screenshotDesktopBackend } = await import('../../src/screenshot/backends.js')
    const blob = await screenshotDesktopBackend(0)
    expect(blob.source).toBe('screenshot-desktop')
    expect(blob.buffer.length).toBe(png.length)
    vi.doUnmock('screenshot-desktop')
  })
})