/**
 * Mouse drag: mouseDrag(fromX, fromY, toX, toY).
 *
 * Implemented as a four-step atomic sequence:
 *   mouseMove(fromX, fromY)
 *   mouseDown('left')
 *   mouseMove(toX, toY)
 *   mouseUp('left')
 *
 * Bounds validation runs at every step (mouseMove validates both endpoints).
 * Native-tool selection is identical to mouse.ts; shared routing helpers
 * (isMockMode, validateCoords) come from ./routing.js. The left button is the
 * only supported drag button; right-button drags would require a different
 * platformAdapter.
 */

import { mouseDown, mouseMove, mouseUp } from './mouse.js'
import { isMockMode, validateCoords } from './routing.js'
import type { MouseOptions } from './types.js'

export async function mouseDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  opts?: MouseOptions,
): Promise<void> {
  validateCoords(fromX, fromY)
  validateCoords(toX, toY)
  if (isMockMode()) {
    void opts
    return
  }
  await mouseMove(fromX, fromY, opts)
  await mouseDown('left')
  await mouseMove(toX, toY, opts)
  await mouseUp('left')
}