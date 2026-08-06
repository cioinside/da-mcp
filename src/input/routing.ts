/**
 * Shared input-subsystem routing helpers.
 *
 * Used by mouse.ts, keyboard.ts, scroll.ts, and drag.ts to keep CLI dispatch
 * uniform across OS+display combinations:
 *   Linux + X11     → xdotool CLI
 *   Linux + Wayland → ydotool / wtype CLI
 *   macOS / Windows → robotjs (native, lazy-loaded)
 *   unknown         → throw DaMcpError('NATIVE_MISSING')
 *
 * Every spawnSync / spawn call uses shell:false. Bounds validation runs at
 * every public entry point; in DA_MCP_TEST_MODE=mock native calls are skipped
 * via isMockMode().
 *
 * This module is internal to the input subsystem. Consumers should import from
 * src/input/index.js, not from here directly.
 */

import { spawnSync } from 'node:child_process'
import { getConfig } from '../config.js'
import { DaMcpError } from '../errors.js'
import { detectPlatform } from '../platform/detect.js'
import type { AvailableTools, PlatformInfo } from '../platform/types.js'

/** Maximum screen-coordinate value we accept. Stays well within X11 limits (32767). */
export const MAX_COORD = 32767

/** Validate that (x, y) are finite non-negative integers within MAX_COORD. Throws OUT_OF_BOUNDS otherwise. */
export function validateCoords(x: number, y: number): void {
  if (
    !Number.isInteger(x) || !Number.isFinite(x) || x < 0 || x > MAX_COORD ||
    !Number.isInteger(y) || !Number.isFinite(y) || y < 0 || y > MAX_COORD
  ) {
    throw new DaMcpError(
      'OUT_OF_BOUNDS',
      `coordinates (${String(x)}, ${String(y)}) are out of bounds; expected finite non-negative integers ≤ ${String(MAX_COORD)}`,
    )
  }
}

/** True iff DA_MCP_TEST_MODE=mock — native calls should be skipped. */
export function isMockMode(): boolean {
  return getConfig().testMode === 'mock'
}

/**
 * Run a CLI binary with shell:false.
 * Throws DaMcpError('NATIVE_MISSING') on ENOENT, 'NATIVE_FAILED' on non-zero exit.
 */
export function runCli(command: string, argv: readonly string[]): void {
  const result = spawnSync(command, argv, { shell: false, stdio: 'ignore' })
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError('NATIVE_MISSING', `${command} not found on PATH`)
    }
    throw new DaMcpError('NATIVE_FAILED', `${command} failed to start`, err)
  }
  if (result.status !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `${command} exited with status ${String(result.status)}`,
    )
  }
}

/** The supported subset of (os, display) for input routing. */
export interface Routing {
  readonly os: 'linux' | 'darwin' | 'win32'
  readonly display: 'x11' | 'wayland' | 'native'
}

/** Resolve the input subsystem's runtime environment. Throws NATIVE_MISSING on unsupported combos. */
export function resolveRouting(): Routing {
  const info: PlatformInfo = detectPlatform()
  if (info.os === 'unknown') {
    throw new DaMcpError('NATIVE_MISSING', 'unknown OS — no input backend available')
  }
  if (info.os === 'linux') {
    if (info.display === 'unknown') {
      throw new DaMcpError('NATIVE_MISSING', 'linux without DISPLAY/WAYLAND_DISPLAY — no input backend')
    }
    if (info.display === 'x11' || info.display === 'wayland') {
      return { os: 'linux', display: info.display }
    }
    throw new DaMcpError('NATIVE_MISSING', `linux with display '${info.display}' is not supported`)
  }
  // darwin | win32
  if (info.display !== 'native') {
    throw new DaMcpError(
      'NATIVE_MISSING',
      `${info.os} with display '${info.display}' is not supported`,
    )
  }
  return { os: info.os, display: 'native' }
}

/** Throw NATIVE_MISSING if the required CLI tool is not on PATH. */
export function requireTool(
  tools: AvailableTools,
  name: keyof AvailableTools,
  routing: Routing,
): void {
  if (!tools[name]) {
    throw new DaMcpError(
      'NATIVE_MISSING',
      `required tool '${name}' is not installed on this ${routing.os}+${routing.display} system`,
    )
  }
}

/**
 * Lazy-load the robotjs native module. Throws NATIVE_MISSING on MODULE_NOT_FOUND.
 *
 * Note on the `.default` unwrap:
 *   This package's `package.json` declares `"type": "module"` (ESM), but robotjs
 *   is a plain CJS module (`module.exports = nativeBinding`). When ESM code
 *   dynamically imports a CJS module via `await import('robotjs')`, Node
 *   returns the namespace `{ default: module.exports, ...staticNamedExports }`.
 *   `cjs-module-lexer` cannot statically enumerate exports from the
 *   `module.exports = nativeBinding` shape, so every callable (`typeString`,
 *   `keyTap`, `mouseClick`, `getMousePos`, `screen.capture`, etc.) lives only
 *   on `.default`. If we returned the raw namespace, every downstream
 *   `robotjs.X()` call would dispatch on `undefined` and throw
 *   `robotjs.X is not a function`.
 *
 *   We unwrap `.default` here so the rest of the input subsystem can keep
 *   calling `robotjs.keyTap(...)`, `robotjs.mouseClick(...)`, etc. as before.
 *   The `?? m` fallback keeps us forward-compatible if robotjs ever ships as
 *   a real ESM module (in which case the named exports would appear at the
 *   top level).
 */
export async function loadRobotjs(): Promise<typeof import('robotjs')> {
  try {
    const m = await import('robotjs')
    return ((m as { default?: typeof import('robotjs') }).default ?? m) as typeof import('robotjs')
  } catch (e) {
    if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new DaMcpError('NATIVE_MISSING', 'robotjs native module not installed', e)
    }
    throw e
  }
}
