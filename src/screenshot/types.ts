/**
 * Public types for the screenshot subsystem.
 *
 * Boundaries:
 *   - `ScreenshotOptions` and `ScreenshotResult` are the public contract.
 *   - `ScreenshotSource` is a closed enum that lists every backend we may
 *     have produced a capture from. Adding a new backend = add one literal
 *     here and one branch in `screenshot.ts`.
 *
 * The fake clock is part of the result so logs and tests can assert
 * `durationMs` without sleeping.
 */

export interface ScreenshotOptions {
  /** When true, capture cursor in the screenshot. Default: false (hide cursor). */
  showCursor?: boolean
  /** Format: only 'png' is supported. */
  format?: 'png'
}

export type ScreenshotSource =
  | 'node-screenshots'
  | 'screenshot-desktop'
  | 'cli-scrot'
  | 'cli-grim'
  | 'cli-screencapture'
  | 'windows-cli'
  | 'mock'

export interface ScreenshotResult {
  /** Raw PNG buffer. */
  buffer: Buffer
  /** Which backend produced the capture (for logging + diagnostics). */
  source: ScreenshotSource
  /** The display id the capture was taken from. null-input resolves to the primary. */
  displayId: number
  /** Width of the captured image in pixels. */
  widthPx: number
  /** Height of the captured image in pixels. */
  heightPx: number
  /** Wall-clock duration of the capture call, in milliseconds. */
  durationMs: number
}
