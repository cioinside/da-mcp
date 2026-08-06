/**
 * Platform detection — runs at server startup BEFORE initConfig().
 *
 * This module reads process.platform, process.arch, and process.env directly.
 * It does NOT call getConfig() — the init order is:
 *   1. detectPlatform()  — must run before config is needed
 *   2. initConfig()      — populates the config singleton from process.env
 *   3. everything else   — can now call getConfig()
 *
 * Exports internal helpers (detectOs, detectDisplayServer, probeTools) so
 * tests can exercise each branch independently without mutating process state.
 */

import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type {
  AvailableTools,
  DisplayServerId,
  OsId,
  PlatformInfo,
} from './types.js'

// Canonical list of tool names probed. Single source of truth — `probeTools`
// iterates this object so adding a new tool = add 1 key here and 1 in types.ts.
const TOOL_NAMES: readonly (keyof AvailableTools)[] = [
  'xdotool',
  'ydotool',
  'wtype',
  'wmctrl',
  'screenshotDesktop',
  'nutjs',
  'tesseract',
  'scrot',
  'grim',
  'screencapture',
]

function emptyTools(): AvailableTools {
  return {
    xdotool: false,
    ydotool: false,
    wtype: false,
    wmctrl: false,
    screenshotDesktop: false,
    nutjs: false,
    tesseract: false,
    scrot: false,
    grim: false,
    screencapture: false,
  }
}

/** Map a NodeJS.Platform string to our canonical OsId. Unknown → 'unknown'. */
export function detectOs(platform: NodeJS.Platform = process.platform): OsId {
  switch (platform) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'win32'
    default:
      return 'unknown'
  }
}

export interface DisplayServerResult {
  display: DisplayServerId
  displayEnv: string | null
}

/**
 * Resolve the display server for the given OS + env.
 *  - Linux + WAYLAND_DISPLAY set → 'wayland'
 *  - Linux + DISPLAY set        → 'x11'
 *  - Linux + neither            → 'unknown'
 *  - darwin / win32             → 'native'
 *  - unknown OS                 → 'unknown'
 *
 * `displayEnv` returns the raw value of DISPLAY / WAYLAND_DISPLAY when the
 * corresponding display server was detected, else null.
 */
export function detectDisplayServer(
  os: OsId,
  env: NodeJS.ProcessEnv,
): DisplayServerResult {
  if (os === 'linux') {
    const wayland = env['WAYLAND_DISPLAY']
    const display = env['DISPLAY']
    if (typeof wayland === 'string' && wayland.length > 0) {
      return { display: 'wayland', displayEnv: wayland }
    }
    if (typeof display === 'string' && display.length > 0) {
      return { display: 'x11', displayEnv: display }
    }
    return { display: 'unknown', displayEnv: null }
  }
  if (os === 'darwin' || os === 'win32') {
    return { display: 'native', displayEnv: null }
  }
  return { display: 'unknown', displayEnv: null }
}

/** True iff the binary `name` is findable on PATH. Uses `which` (POSIX) / `where` fallback skipped — Windows hosts have no `which` by default; status !== 0 covers that. */
function isOnPath(name: string): boolean {
  const result = spawnSync('which', [name], { stdio: 'ignore' })
  return result.status === 0
}

/**
 * Probe tool availability.
 *
 * When `mock === true`, every tool is reported as unavailable. This is the
 * `DA_MCP_TEST_MODE=mock` codepath: tests use it to assert a fully controlled
 * (empty) AvailableTools shape without spawning real subprocesses.
 *
 * When `mock === false`, each entry in TOOL_NAMES is probed via
 * `which <name>` (status === 0 means present on PATH).
 */
export function probeTools(mock: boolean): AvailableTools {
  if (mock) return emptyTools()
  const tools = emptyTools()
  for (const name of TOOL_NAMES) {
    tools[name] = isOnPath(name)
  }
  return tools
}

/**
 * Detect the current platform, display server, and tool availability.
 *
 * Safe to call BEFORE initConfig() — reads process.env directly, never
 * touches the config singleton.
 *
 * Honors DA_MCP_TEST_MODE=mock by reporting every tool as unavailable.
 */
export function detectPlatform(): PlatformInfo {
  const os = detectOs()
  const { display, displayEnv } = detectDisplayServer(os, process.env)
  const mock = process.env['DA_MCP_TEST_MODE'] === 'mock'
  return {
    os,
    display,
    displayEnv,
    arch: process.arch,
    tools: probeTools(mock),
  }
}

/**
 * Assert that platform detection produced a usable OS. Throws
 * DaMcpError('PLATFORM_INIT_FAILED') when `info.os === 'unknown'` —
 * i.e. we could not map process.platform to a supported OS at all.
 *
 * This is the canonical PLATFORM_INIT_FAILED throw site: callers
 * (captureScreenshot, listDisplays) call it as the first real-mode
 * step so the failure mode is distinct from UNSUPPORTED_PLATFORM
 * (known OS but unsupported OS+display combo).
 */
export function assertPlatformSupported(info: PlatformInfo): void {
  if (info.os === 'unknown') {
    throw new DaMcpError(
      'PLATFORM_INIT_FAILED',
      `Could not determine a supported OS (process.platform='${process.platform}')`,
    )
  }
}