/**
 * da_drag — drag from (x1, y1) to (x2, y2).
 *
 * The button parameter is accepted in the schema for forward compatibility,
 * but mouseDrag() in src/input/drag.ts currently only supports the 'left'
 * button — extra buttons are validated but ignored. This matches the contract
 * documented on the underlying function.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseDrag } from '../input/index.js'
import type { MouseButton } from '../platform/types.js'

const MOUSE_BUTTONS: readonly [MouseButton, ...MouseButton[]] = [
  'left',
  'right',
  'middle',
  'back',
  'forward',
]

const schema = z.object({
  x1: z.number().int().min(0).max(32767),
  y1: z.number().int().min(0).max(32767),
  x2: z.number().int().min(0).max(32767),
  y2: z.number().int().min(0).max(32767),
  button: z.enum(MOUSE_BUTTONS).optional(),
})

export const daDrag = defineTool({
  name: 'da_drag',
  description:
    'Drag from (x1, y1) to (x2, y2). Button defaults to "left"; non-left buttons are accepted in the schema but currently ignored.',
  inputSchema: schema,
  handler: async (input) => {
    await mouseDrag(input.x1, input.y1, input.x2, input.y2)
    return {
      from: { x: input.x1, y: input.y1 },
      to: { x: input.x2, y: input.y2 },
    }
  },
})