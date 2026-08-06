/**
 * Mouse scroll: mouseScroll(dx, dy).
 *
 * Positive dy = scroll down. Positive dx = scroll right.
 *
 * Routing per OS+display server:
 *   Linux + X11     → xdotool click 4 (up) / 5 (down), 6 (left) / 7 (right)
 *   Linux + Wayland → ydotool click 4 / 5 / 6 / 7
 *   macOS / Windows → @nut-tree-fork/nut-js scrollUp/Down/Left/Right (per-axis)
 *   unknown         → throw DaMcpError('NATIVE_MISSING')
 *
 * stepPx controls granularity: each scroll "unit" issues one click event.
 * Defaults to 1 (one click per unit of dy/dx).
 *
 * Diagonal scrolling: robotjs supported diagonal scroll in a single
 * `scrollMouse(dx, dy)` call. nut.js's libnut exposes per-axis methods
 * only (`scrollUp / scrollDown / scrollLeft / scrollRight`), so we
 * emulate diagonal by issuing the vertical axis first then the horizontal
 * axis — matching the Linux + xdotool/ydotool branch order above so the
 * perceived direction is identical across platforms.
 */

import { mouse } from '@nut-tree-fork/nut-js'
import { DaMcpError } from '../errors.js'
import { detectPlatform } from '../platform/detect.js'
import type { ScrollOptions } from './types.js'
import {
  isMockMode,
  requireTool,
  resolveRouting,
  runCli,
} from './routing.js'

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
  // macOS / Windows — @nut-tree-fork/nut-js (per-axis). Diagonal = vertical
  // first then horizontal, matching the Linux branch above so the caller's
  // perceived direction is identical across platforms.
  const sx = Math.abs(Math.trunc(dx / stepPx))
  const sy = Math.abs(Math.trunc(dy / stepPx))
  if (dy > 0) await mouse.scrollDown(sy)
  else if (dy < 0) await mouse.scrollUp(sy)
  if (dx > 0) await mouse.scrollRight(sx)
  else if (dx < 0) await mouse.scrollLeft(sx)
}