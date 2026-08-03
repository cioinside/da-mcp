/**
 * da_double_click — convenience wrapper for mouseClick('left', 2).
 *
 * When x and y are provided, the cursor moves first.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseClick, mouseMove } from '../input/index.js'

const schema = z.object({
  x: z.number().int().min(0).max(32767).optional(),
  y: z.number().int().min(0).max(32767).optional(),
})

export const daDoubleClick = defineTool({
  name: 'da_double_click',
  description: 'Double-click the left mouse button. Moves to (x, y) first when provided.',
  inputSchema: schema,
  handler: async (input) => {
    if (input.x !== undefined && input.y !== undefined) {
      await mouseMove(input.x, input.y)
    }
    await mouseClick('left', 2)
    return { button: 'left', count: 2 }
  },
})