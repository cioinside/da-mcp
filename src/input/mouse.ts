/**
 * Mouse operations: mouseMove / mouseClick / mouseDown / mouseUp / getMousePosition.
 *
 * Routing per OS+display server and the shared helpers (runCli, resolveRouting,
 * requireTool, loadRobotjs, isMockMode, validateCoords) live in ./routing.ts.
 * This module focuses on mouse-specific behavior and the mouse shell-location
 * parsers (parseShellLocation, readShellLocation) used by getMousePosition.
 *
 *   Linux + X11     → xdotool CLI
 *   Linux + Wayland → ydotool CLI
 *   macOS / Windows → robotjs (native, lazy-loaded)
 *   unknown         → throw DaMcpError('NATIVE_MISSING')
 *
 * Every spawnSync call uses shell:false. Bounds validation always runs;
 * in DA_MCP_TEST_MODE=mock the native call is skipped and the function
 * resolves immediately after validation.
 */

import { spawnSync } from 'node:child_process'
import { detectPlatform } from '../platform/detect.js'
import { DaMcpError } from '../errors.js'
import type { MouseButton } from '../platform/types.js'
import type { MouseOptions } from './types.js'
import {
  isMockMode,
  loadRobotjs,
  requireTool,
  resolveRouting,
  runCli,
  validateCoords,
} from './routing.js'

/** X11 / ydotool button codes (1=left, 2=middle, 3=right, 8=back, 9=forward). */
function mouseButtonCode(button: MouseButton): number {
  switch (button) {
    case 'left': return 1
    case 'middle': return 2
    case 'right': return 3
    case 'back': return 8
    case 'forward': return 9
  }
}

export async function mouseMove(x: number, y: number, opts?: MouseOptions): Promise<void> {
  validateCoords(x, y)
  if (isMockMode()) {
    void opts
    return
  }
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['mousemove', String(x), String(y)])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    runCli('ydotool', ['mousemove', '--absolute', String(x), String(y)])
    return
  }
  // macOS / Windows — robotjs
  const robotjs = await loadRobotjs()
  robotjs.moveMouse(x, y)
  void opts
}

export async function mouseClick(button: MouseButton, count: number = 1): Promise<void> {
  if (!Number.isInteger(count) || count < 1) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `count must be a positive integer, got ${String(count)}`,
    )
  }
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  const code = mouseButtonCode(button)
  if (routing.os === 'linux') {
    const tool = routing.display === 'x11' ? 'xdotool' : 'ydotool'
    requireTool(info.tools, tool, routing)
    for (let i = 0; i < count; i++) {
      runCli(tool, ['click', String(code)])
    }
    return
  }
  // macOS / Windows
  const robotjs = await loadRobotjs()
  robotjs.mouseClick(button, count >= 2)
}

export async function mouseDown(button: MouseButton): Promise<void> {
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  const code = mouseButtonCode(button)
  if (routing.os === 'linux') {
    const tool = routing.display === 'x11' ? 'xdotool' : 'ydotool'
    requireTool(info.tools, tool, routing)
    runCli(tool, ['mousedown', String(code)])
    return
  }
  const robotjs = await loadRobotjs()
  robotjs.mouseToggle('down', button)
}

export async function mouseUp(button: MouseButton): Promise<void> {
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  const code = mouseButtonCode(button)
  if (routing.os === 'linux') {
    const tool = routing.display === 'x11' ? 'xdotool' : 'ydotool'
    requireTool(info.tools, tool, routing)
    runCli(tool, ['mouseup', String(code)])
    return
  }
  const robotjs = await loadRobotjs()
  robotjs.mouseToggle('up', button)
}

/**
 * Parse an `xdotool getmouselocation --shell` style output.
 * Format: "X=123\nY=456\nSCREEN=0\nWINDOW=...\n".
 * Lines that do not start with X= / Y= are ignored. Throws
 * DaMcpError('NATIVE_FAILED') when either X or Y cannot be parsed.
 */
export function parseShellLocation(stdout: string): { x: number; y: number } {
  let x: number | null = null
  let y: number | null = null
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('X=')) {
      const n = Number(trimmed.slice(2))
      if (Number.isInteger(n)) x = n
    } else if (trimmed.startsWith('Y=')) {
      const n = Number(trimmed.slice(2))
      if (Number.isInteger(n)) y = n
    }
  }
  if (x === null || y === null) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `could not parse X/Y from tool output: ${stdout}`,
    )
  }
  return { x, y }
}

/**
 * Spawn a CLI binary with shell:false and capture stdout. Returns the
 * parsed X/Y. Throws DaMcpError('NATIVE_MISSING') on ENOENT, 'NATIVE_FAILED'
 * on non-zero exit or when stdout cannot be parsed.
 */
export function readShellLocation(command: string, argv: readonly string[]): { x: number; y: number } {
  const result = spawnSync(command, argv, {
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
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
      `${command} ${argv.join(' ')} exited with status ${String(result.status)}`,
    )
  }
  const stdout = result.stdout.toString('utf8')
  return parseShellLocation(stdout)
}

/** Return current cursor position as integer screen coords. */
export async function getMousePosition(): Promise<{ x: number; y: number }> {
  if (isMockMode()) return { x: 0, y: 0 }
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    return readShellLocation('xdotool', ['getmouselocation', '--shell'])
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    return readShellLocation('ydotool', ['getmouselocation'])
  }
  // macOS / Windows — robotjs.getMousePos()
  const robotjs = await loadRobotjs()
  try {
    const pos = robotjs.getMousePos()
    if (!Number.isInteger(pos.x) || !Number.isInteger(pos.y)) {
      throw new DaMcpError(
        'NATIVE_FAILED',
        `robotjs.getMousePos() returned non-integer coords: x=${String(pos.x)}, y=${String(pos.y)}`,
      )
    }
    return { x: pos.x, y: pos.y }
  } catch (e) {
    if (e instanceof DaMcpError) throw e
    throw new DaMcpError(
      'NATIVE_FAILED',
      'robotjs.getMousePos() failed',
      e instanceof Error ? e : undefined,
    )
  }
}