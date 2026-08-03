/**
 * da_key — press a single key (with optional modifiers) or hold a key.
 *
 * modifiers is an ordered list of 'ctrl' | 'alt' | 'shift' | 'meta' | 'super'.
 * holdMs > 0 with no modifiers performs a press-and-release delay.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { keyTap } from '../input/index.js'
import type { Modifier } from '../platform/types.js'

const MODIFIERS: readonly [Modifier, ...Modifier[]] = [
  'ctrl',
  'alt',
  'shift',
  'meta',
  'super',
]

const schema = z.object({
  key: z.string().min(1),
  modifiers: z.array(z.enum(MODIFIERS)).optional(),
  holdMs: z.number().int().min(0).optional(),
})

export const daKey = defineTool({
  name: 'da_key',
  description:
    'Press a key by name, optionally with modifiers (e.g. {"key":"c","modifiers":["ctrl"]} for Ctrl+C). holdMs > 0 issues a press-hold-release.',
  inputSchema: schema,
  handler: async (input) => {
    const opts = input.holdMs !== undefined ? { holdMs: input.holdMs } : {}
    await keyTap(input.key, input.modifiers, opts)
    return { key: input.key, modifiers: input.modifiers ?? [] }
  },
})