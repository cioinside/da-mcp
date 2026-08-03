/**
 * da_scroll — scroll the wheel by (dx, dy).
 *
 * Positive dy = scroll down; positive dx = scroll right. stepPx controls
 * how many pixels each scroll "unit" represents (default 1). When x and y are
 * given, the cursor moves to that position before scrolling.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseScroll, mouseMove } from '../input/index.js'

const schema = z.object({
  dx: z.number().int(),
  dy: z.number().int(),
  x: z.number().int().min(0).max(32767).optional(),
  y: z.number().int().min(0).max(32767).optional(),
  stepPx: z.number().int().min(1).optional(),
})

export const daScroll = defineTool({
  name: 'da_scroll',
  description:
    'Scroll the wheel at the current (or given) cursor position by (dx, dy) pixel deltas. Positive dy = down, positive dx = right.',
  inputSchema: schema,
  handler: async (input) => {
    if (input.x !== undefined && input.y !== undefined) {
      await mouseMove(input.x, input.y)
    }
    const opts = input.stepPx !== undefined ? { stepPx: input.stepPx } : {}
    await mouseScroll(input.dx, input.dy, opts)
    return { dx: input.dx, dy: input.dy, stepPx: input.stepPx ?? 1 }
  },
})