/**
 * Screenshot backend implementations.
 *
 * Each backend exposes a uniform `CaptureBlob` (PNG buffer + source + dimensions).
 * The dispatcher in ./index.ts walks backends in priority order until one succeeds.
 *
 * PERMISSION_DENIED detection: every backend that uses native code routes any
 * thrown error whose message matches a permission-gate pattern through
 * `permissionErrorFor()`, which re-throws as DaMcpError('PERMISSION_DENIED')
 * with the original cause preserved.
 *
 * screenshot-desktop ships no .d.ts — see ./screenshot-desktop.d.ts for the
 * ambient module declaration.
 */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { ScreenshotSource } from './types.js'

/** Result of a single backend call. Dispatcher wraps into ScreenshotResult. */
export interface CaptureBlob {
  buffer: Buffer
  source: ScreenshotSource
  widthPx: number
  heightPx: number
}

/** Permission-gate phrases emitted by OS capture APIs. Case-insensitive.
 * Requires "permission" to appear near "screen" / "recording" / "screencapture"
 * so unrelated messages that mention "permission" in passing do not match. */
const PERMISSION_PATTERN = /screen.{0,30}permission|permission.{0,30}(screen|record)|screencapturekit|access is denied/i

/** True iff `msg` matches an OS permission-gate phrasing. Exported for tests. */
export function isPermissionError(msg: string): boolean {
  return PERMISSION_PATTERN.test(msg)
}

/**
 * If `err`'s message looks like an OS permission gate, re-throw as
 * PERMISSION_DENIED with the original error preserved as cause. Otherwise
 * throw the original `err` unchanged.
 */
function permissionErrorFor(err: unknown, context: string): never {
  if (err instanceof DaMcpError) {
    throw err
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (isPermissionError(msg)) {
    throw new DaMcpError('PERMISSION_DENIED', `${context}: ${msg}`, err)
  }
  throw err
}

interface CliOpts {
  readonly bin: string
  readonly args: readonly string[]
  readonly timeoutMs: number
  readonly context: string
}

/** Spawn `bin` with `args`, collect stdout, surface stderr on non-zero exit. */
export function runCliCapture(opts: CliOpts): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false
    let child
    try {
      child = spawn(opts.bin, [...opts.args], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      reject(new DaMcpError('NATIVE_MISSING', `${opts.context} failed to spawn`, err))
      return
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      if (!settled) {
        settled = true
        reject(
          new DaMcpError(
            'NATIVE_FAILED',
            `${opts.context} timed out after ${String(opts.timeoutMs)}ms`,
          ),
        )
      }
    }, opts.timeoutMs)
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    if (child.stdout) {
      child.stdout.on('data', (c: Buffer) => chunks.push(c))
    }
    if (child.stderr) {
      child.stderr.on('data', (c: Buffer) => stderrChunks.push(c))
    }
    child.on('error', (err: Error) =>
      settle(() => {
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        const detail = stderr.length > 0 ? `${err.message}: ${stderr}` : err.message
        if (isPermissionError(detail)) {
          reject(
            new DaMcpError('PERMISSION_DENIED', `${opts.context} denied: ${detail}`, err),
          )
          return
        }
        reject(
          new DaMcpError('NATIVE_MISSING', `${opts.context} not available: ${detail}`, err),
        )
      }),
    )
    child.on('close', (code: number | null) =>
      settle(() => {
        if (code !== 0) {
          const stderr = Buffer.concat(stderrChunks).toString('utf8')
          const detail = stderr.length > 0 ? stderr : `exit code ${String(code)}`
          if (isPermissionError(detail)) {
            reject(new DaMcpError('PERMISSION_DENIED', `${opts.context} denied: ${detail}`))
            return
          }
          reject(new DaMcpError('NATIVE_FAILED', `${opts.context} exited: ${detail}`))
          return
        }
        resolve(Buffer.concat(chunks))
      }),
    )
  })
}

/** Secondary backend: screenshot-desktop (cross-platform CJS wrapper). */
export async function screenshotDesktopBackend(
  displayId: number | null,
): Promise<CaptureBlob> {
  let mod: typeof import('screenshot-desktop').default
  try {
    mod = (await import('screenshot-desktop')).default
  } catch (err) {
    permissionErrorFor(err, 'screenshot-desktop import')
    throw new DaMcpError('NATIVE_MISSING', 'screenshot-desktop unavailable', err)
  }
  let buffer: Buffer
  try {
    // screenshot-desktop defaults to JPEG; da-mcp requires PNG (validatePngBuffer
    // rejects any non-PNG buffer with SCREENSHOT_EMPTY). Always request PNG so
    // the returned buffer survives magic-byte validation downstream.
    const opts =
      displayId === null ? { format: 'png' } : { screen: displayId, format: 'png' }
    buffer = await mod(opts)
  } catch (err) {
    permissionErrorFor(err, 'screenshot-desktop capture')
    throw new DaMcpError('NATIVE_FAILED', 'screenshot-desktop capture failed', err)
  }
  if (buffer === null || buffer === undefined || buffer.length === 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `screenshot-desktop returned ${buffer === null || buffer === undefined ? 'null' : '0 bytes'} for displayId=${String(displayId)}; falling back to next backend.`,
    )
  }
  return { buffer, source: 'screenshot-desktop', widthPx: 0, heightPx: 0 }
}

/**
 * Tertiary backend for Windows: PowerShell + System.Drawing BitBlt.
 *
 * Spans a `powershell.exe -NoProfile -Command <script>` child, captures stdout
 * PNG bytes, and rejects with NATIVE_MISSING/PERMISSION_DENIED/NATIVE_FAILED
 * depending on what the spawn returns.
 */
export async function windowsCliBackend(): Promise<CaptureBlob> {
  const psScript = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$screens = [System.Windows.Forms.Screen]::AllScreens',
    '$top = ($screens | Measure-Object -Property { $_.Bounds.Top } -Minimum).Minimum',
    '$left = ($screens | Measure-Object -Property { $_.Bounds.Left } -Minimum).Minimum',
    '$width = ($screens | Measure-Object -Property { $_.Bounds.Right } -Maximum).Maximum - $left',
    '$height = ($screens | Measure-Object -Property { $_.Bounds.Bottom } -Maximum).Maximum - $top',
    '$bmp = New-Object System.Drawing.Bitmap $width, $height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)',
    '$ms = New-Object System.IO.MemoryStream',
    '$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)',
    '$ms.ToArray() | Write-Host -NoNewline',
  ].join('\n')
  const buffer = await runCliCapture({
    bin: 'powershell.exe',
    args: ['-NoProfile', '-Command', psScript],
    timeoutMs: 30_000,
    context: 'PowerShell BitBlt',
  })
  if (buffer.length === 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      'PowerShell BitBlt returned 0 bytes (TCC permission denied or session 0?).',
    )
  }
  return { buffer, source: 'windows-cli', widthPx: 0, heightPx: 0 }
}