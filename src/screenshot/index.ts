/**
 * Screenshot public API + dispatcher.
 *
 * `captureScreenshot` walks backends in priority order — screenshot-desktop,
 * then the OS-specific CLI fallback (scrot / grim / screencapture, or
 * PowerShell BitBlt on Windows). Errors that signal "no further backend will
 * help" propagate immediately (DISPLAY_NOT_FOUND, UNSUPPORTED_PLATFORM,
 * PLATFORM_INIT_FAILED, PERMISSION_DENIED). Everything else falls through to
 * the next backend.
 *
 * Mock mode short-circuits the whole chain with the deterministic fixture
 * declared in `./png.ts`.
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import {
  assertPlatformSupported,
  detectPlatform,
} from '../platform/detect.js'
import type { DisplayInfo, DisplayServerId, OsId } from '../platform/types.js'
import {
  runCliCapture,
  screenshotDesktopBackend,
  windowsCliBackend,
  type CaptureBlob,
} from './backends.js'
import {
  MOCK_DISPLAY,
  checkPngMagic,
  isMockMode,
  mockPngBuffer,
  validatePngBuffer,
} from './png.js'
import { listDisplaysLinux } from './list-displays-linux.js'
import { listDisplaysMacos } from './list-displays-macos.js'
import { listDisplaysWindows } from './list-displays-windows.js'
import type { ScreenshotOptions, ScreenshotResult, ScreenshotSource } from './types.js'

export type { ScreenshotOptions, ScreenshotResult, ScreenshotSource }

/** Re-exports for backwards compatibility (tests + tools import these names). */
export { checkPngMagic, isMockMode, validatePngBuffer }

async function findDisplay(displayId: number): Promise<DisplayInfo> {
  const displays = await listDisplays()
  const found = displays.find((d) => d.id === displayId)
  if (!found) {
    throw new DaMcpError(
      'DISPLAY_NOT_FOUND',
      `No display matches displayId=${String(displayId)}`,
    )
  }
  return found
}

/** OS-specific CLI screenshot tool. Empty tuple means "no CLI fallback for this combo". */
function cliFallbackFor(
  os: OsId,
  display: DisplayServerId,
): readonly [string, readonly string[], ScreenshotSource][] {
  if (os === 'linux' && display === 'x11') {
    return [['scrot', [], 'cli-scrot']]
  }
  if (os === 'linux' && display === 'wayland') {
    return [['grim', [], 'cli-grim']]
  }
  if (os === 'darwin') {
    return [['screencapture', ['-x'], 'cli-screencapture']]
  }
  return []
}

/** True iff `err` is a DaMcpError code that no further backend can satisfy. */
function isTerminal(err: unknown): boolean {
  if (!(err instanceof DaMcpError)) return false
  switch (err.code) {
    case 'DISPLAY_NOT_FOUND':
    case 'UNSUPPORTED_PLATFORM':
    case 'PLATFORM_INIT_FAILED':
    case 'PERMISSION_DENIED':
    case 'INVALID_ARGUMENT':
      return true
    default:
      return false
  }
}

/**
 * Walk backends in order. PERMISSION_DENIED, DISPLAY_NOT_FOUND,
 * UNSUPPORTED_PLATFORM, PLATFORM_INIT_FAILED, INVALID_ARGUMENT propagate
 * immediately; everything else falls through.
 */
async function dispatchCapture(
  displayId: number | null,
  timeoutMs: number,
): Promise<CaptureBlob> {
  if (displayId !== null) {
    await findDisplay(displayId)
  }

  // Tier 1: screenshot-desktop.
  try {
    return await screenshotDesktopBackend(displayId)
  } catch (err) {
    if (isTerminal(err)) throw err
  }

  // Tier 2: OS-specific CLI fallback.
  const info = detectPlatform()
  if (info.os === 'win32') {
    return await windowsCliBackend()
  }
  const chain = cliFallbackFor(info.os, info.display)
  if (chain.length === 0) {
    throw new DaMcpError(
      'NATIVE_MISSING',
      `No screenshot backend for os=${info.os} display=${info.display}`,
    )
  }
  const head = chain[0]
  if (head === undefined) {
    throw new DaMcpError('NATIVE_MISSING', `Empty CLI fallback chain`)
  }
  const [bin, args, source] = head
  const buffer = await runCliCapture({
    bin,
    args,
    timeoutMs,
    context: source,
  })
  return { buffer, source, widthPx: 0, heightPx: 0 }
}

/** Capture a screenshot and return the raw PNG buffer. */
export async function screenshot(
  displayId: number | null = null,
  opts?: ScreenshotOptions,
): Promise<Buffer> {
  const result = await captureScreenshot(displayId, opts)
  return result.buffer
}

/** Capture a screenshot with full provenance (source, dimensions, duration). */
export async function captureScreenshot(
  displayId: number | null = null,
  opts: ScreenshotOptions = {},
): Promise<ScreenshotResult> {
  void opts
  const start = Date.now()
  if (isMockMode()) {
    if (displayId !== null) await findDisplay(displayId)
    return {
      buffer: mockPngBuffer(),
      source: 'mock',
      displayId: displayId ?? 0,
      widthPx: MOCK_DISPLAY.bounds.width,
      heightPx: MOCK_DISPLAY.bounds.height,
      durationMs: Date.now() - start,
    }
  }
  const info = detectPlatform()
  assertPlatformSupported(info)
  const blob = await dispatchCapture(displayId, 30_000)
  validatePngBuffer(blob.buffer)
  return {
    buffer: blob.buffer,
    source: blob.source,
    displayId: displayId ?? 0,
    widthPx: blob.widthPx,
    heightPx: blob.heightPx,
    durationMs: Date.now() - start,
  }
}

/** List connected displays. */
export async function listDisplays(): Promise<DisplayInfo[]> {
  if (isMockMode()) return [MOCK_DISPLAY]
  const info = detectPlatform()
  assertPlatformSupported(info)
  switch (info.os) {
    case 'linux':
      return listDisplaysLinux(info.display)
    case 'darwin':
      return listDisplaysMacos()
    case 'win32':
      return listDisplaysWindows()
    default:
      throw new DaMcpError(
        'NATIVE_MISSING',
        `Display enumeration backend not available for os=${info.os}. Use da_window_list for window enumeration.`,
      )
  }
}

// Suppress an unused-import lint when checkPngMagic is only re-exported.
void checkPngMagic