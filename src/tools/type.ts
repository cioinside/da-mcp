/**
 * da_type — type a string at the current focus.
 *
 * Empty strings are accepted as a no-op (matches typeText() behavior). The
 * NUL-byte guard and maxTypeBytes guard live inside typeText() in the input
 * subsystem; this layer does not duplicate them.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { typeText } from '../input/index.js'

const schema = z.object({
  text: z.string().max(65536),
  perCharDelayMs: z.number().int().min(0).optional(),
})

export const daType = defineTool({
  name: 'da_type',
  description:
    'Type a string at the current keyboard focus. Empty string is a no-op. Optional per-char delay (ms).',
  inputSchema: schema,
  handler: async (input) => {
    const opts =
      input.perCharDelayMs !== undefined
        ? { perCharDelayMs: input.perCharDelayMs }
        : {}
    await typeText(input.text, opts)
    return { typed: true, length: input.text.length }
  },
})