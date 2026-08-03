/**
 * da_screenshot — capture a PNG of a display.
 *
 * displayId: null/undefined → primary display; 0..32767 → specific display id.
 * Returns the raw PNG buffer wrapped in a result envelope so the MCP layer
 * can serialize it to a base64 image content.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { screenshot } from '../screenshot/index.js'

const schema = z.object({
  displayId: z.number().int().min(0).max(32767).nullable().optional(),
})

export const daScreenshot = defineTool({
  name: 'da_screenshot',
  description:
    'Capture a PNG screenshot of the primary display (when displayId is null/undefined) or a specific display id (0..32767).',
  inputSchema: schema,
  handler: async (input) => {
    const buffer = await screenshot(input.displayId ?? null)
    return { buffer, length: buffer.length }
  },
})