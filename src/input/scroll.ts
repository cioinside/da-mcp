/**
 * Mouse scroll — public dispatch entry point.
 *
 * Per-OS backends live in `./scroll-{macos,windows}.ts`. Linux stays
 * inline (xdotool / ydotool).
 *
 * Positive dy = scroll down. Positive dx = scroll right.
 *
 * Diagonal scrolling: vertical axis first, then horizontal axis —
 * matching the existing Linux branch order so the perceived direction
 * is identical across platforms.
 */
import { DaMcpError } from '../errors.js'
import { detectPlatform } from '../platform/detect.js'
import type { ScrollOptions } from './types.js'
import {
  isMockMode,
  requireTool,
  resolveRouting,
  runCli,
} from './routing.js'
import { mouseScrollMac } from './scroll-macos.js'
import { mouseScrollWindows } from './scroll-windows.js'

/** X11 / ydotool scroll button codes: 4=up, 5=down, 6=left, 7=right. */
const SCROLL_UP = 4
const SCROLL_DOWN = 5
const SCROLL_LEFT = 6
const SCROLL_RIGHT = 7

function validateScroll(dx: number, dy: number): void {
  if (!Number.isInteger(dx) || !Number.isFinite(dx)) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `dx must be a finite integer, got ${String(dx)}`,
    )
  }
  if (!Number.isInteger(dy) || !Number.isFinite(dy)) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `dy must be a finite integer, got ${String(dy)}`,
    )
  }
}

function emitLinuxClicks(
  tool: 'xdotool' | 'ydotool',
  code: number,
  repeats: number,
): void {
  for (let i = 0; i < repeats; i++) {
    runCli(tool, ['click', String(code)])
  }
}

export async function mouseScroll(dx: number, dy: number, opts?: ScrollOptions): Promise<void> {
  validateScroll(dx, dy)
  if (isMockMode()) {
    void opts
    return
  }
  const stepPx = opts?.stepPx ?? 1
  if (!Number.isInteger(stepPx) || stepPx < 1) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `stepPx must be a positive integer, got ${String(stepPx)}`,
    )
  }
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux') {
    const tool = routing.display === 'x11' ? 'xdotool' : 'ydotool'
    requireTool(info.tools, tool, routing)
    if (dy > 0) emitLinuxClicks(tool, SCROLL_DOWN, Math.abs(Math.trunc(dy / stepPx)))
    else if (dy < 0) emitLinuxClicks(tool, SCROLL_UP, Math.abs(Math.trunc(dy / stepPx)))
    if (dx > 0) emitLinuxClicks(tool, SCROLL_RIGHT, Math.abs(Math.trunc(dx / stepPx)))
    else if (dx < 0) emitLinuxClicks(tool, SCROLL_LEFT, Math.abs(Math.trunc(dx / stepPx)))
    return
  }
  if (routing.os === 'win32') {
    await mouseScrollWindows(dx, dy, stepPx)
    return
  }
  // darwin
  void info
  await mouseScrollMac(dx, dy)
}