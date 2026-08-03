/**
 * da_move_mouse — move the OS cursor to absolute (x, y).
 *
 * Coordinates are validated server-side (0..32767, integer). When DA_MCP_TEST_MODE=mock
 * the underlying mouseMove() short-circuits after validation, so this tool is
 * safely callable from tests without a display server.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseMove } from '../input/index.js'

const schema = z.object({
  x: z.number().int().min(0).max(32767),
  y: z.number().int().min(0).max(32767),
  durationMs: z.number().int().min(0).optional(),
})

export const daMoveMouse = defineTool({
  name: 'da_move_mouse',
  description: 'Move the cursor to absolute (x, y) screen coordinates.',
  inputSchema: schema,
  handler: async (input) => {
    const opts =
      input.durationMs !== undefined ? { durationMs: input.durationMs } : {}
    await mouseMove(input.x, input.y, opts)
    return { moved: true, x: input.x, y: input.y }
  },
})