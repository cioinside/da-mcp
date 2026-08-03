/**
 * da_click — click a mouse button at the current cursor position
 * (or at explicit x, y when provided).
 *
 * When x and y are both given, mouseMove() runs first. button defaults to 'left';
 * count defaults to 1; count=2 yields a double-click.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseClick, mouseMove } from '../input/index.js'
import type { MouseButton } from '../platform/types.js'

const MOUSE_BUTTONS: readonly [MouseButton, ...MouseButton[]] = [
  'left',
  'right',
  'middle',
  'back',
  'forward',
]

const schema = z.object({
  x: z.number().int().min(0).max(32767).optional(),
  y: z.number().int().min(0).max(32767).optional(),
  button: z.enum(MOUSE_BUTTONS).optional(),
  count: z.number().int().min(1).max(10).optional(),
})

export const daClick = defineTool({
  name: 'da_click',
  description:
    'Click a mouse button (defaults to "left", count 1). When x/y are given, the cursor is moved first.',
  inputSchema: schema,
  handler: async (input) => {
    if (input.x !== undefined && input.y !== undefined) {
      await mouseMove(input.x, input.y)
    }
    const button: MouseButton = input.button ?? 'left'
    const count = input.count ?? 1
    await mouseClick(button, count)
    return { button, count }
  },
})