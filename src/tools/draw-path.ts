/**
 * da_draw_path — draw a multi-point path with the mouse.
 *
 * Traces through `points` with the given button held. Useful for freeform
 * shapes, signatures, circles (as N points on the circumference), etc.
 * `modifiers` are held pressed for the duration of the trace (e.g.
 * `["shift"]` for constrained-drawing in Paint). Strict modifier pairing
 * is enforced even on errors — modifiers are released in REVERSE declaration
 * order via try/finally so a throw mid-trace still unlocks stuck keys.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import {
  keyDown,
  keyUp,
  mouseDown,
  mouseMove,
  mouseUp,
} from '../input/index.js'
import { validateCoords } from '../input/routing.js'
import type { Modifier, MouseButton } from '../platform/types.js'

const BUTTONS: readonly [MouseButton, ...MouseButton[]] = ['left', 'right']
const MODIFIERS: readonly [Modifier, ...Modifier[]] = [
  'ctrl',
  'alt',
  'shift',
  'meta',
  'super',
]

const pointTuple = z.tuple([
  z.number().int().min(0).max(32767),
  z.number().int().min(0).max(32767),
])

const schema = z.object({
  points: z.array(pointTuple).min(2),
  button: z.enum(BUTTONS).optional(),
  modifiers: z.array(z.enum(MODIFIERS)).optional(),
  durationMs: z.number().int().min(0).optional(),
})

export const daDrawPath = defineTool({
  name: 'da_draw_path',
  description:
    'Draw a multi-point path with the mouse by tracing through `points` with the given button held. Useful for freeform shapes, signatures, circles (as N points on the circumference), etc. `modifiers` are held pressed for the duration of the trace (e.g. ["shift"] for constrained-drawing in Paint). Strict modifier pairing is enforced even on errors.',
  inputSchema: schema,
  handler: async (input) => {
    const button: MouseButton = input.button ?? 'left'
    const modifiers = input.modifiers ?? []
    const first = input.points[0]
    if (first === undefined) {
      // Unreachable: z.array(...).min(2) guarantees length ≥ 2.
      throw new Error('points array must have at least 2 entries')
    }
    const rest = input.points.slice(1)
    for (const p of input.points) {
      validateCoords(p[0], p[1])
    }
    const moveOpts =
      input.durationMs !== undefined ? { durationMs: input.durationMs } : {}
    try {
      for (const m of modifiers) await keyDown(m)
      await mouseMove(first[0], first[1])
      await mouseDown(button)
      for (const p of rest) {
        await mouseMove(p[0], p[1], moveOpts)
      }
      await mouseUp(button)
    } finally {
      for (let i = modifiers.length - 1; i >= 0; i--) {
        const m = modifiers[i]
        if (m !== undefined) await keyUp(m)
      }
    }
    return {
      traced: input.points.length,
      button,
      modifiers,
    }
  },
})
