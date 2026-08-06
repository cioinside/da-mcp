/**
 * da_screenshot — capture a PNG of a display.
 *
 * displayId: null/undefined → primary display; integer ≥0 → specific display id.
 * Returns the raw PNG buffer wrapped in a result envelope so the MCP layer
 * can serialize it to a base64 image content.
 *
 * BUG HISTORY: previous schema capped displayId at 32767 (Int16 max). Real
 * Windows display IDs from `node-screenshots` are 65537+, so every per-display
 * screenshot call rejected the input as INVALID_ARGUMENT. Raised to Int32 max
 * (2147483647) — comfortably covers the full Int32 range used by Windows GDI
 * for HMONITOR handles.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { screenshot } from '../screenshot/index.js'

const INT32_MAX = 2147483647

const schema = z.object({
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
})

export const daScreenshot = defineTool({
  name: 'da_screenshot',
  description:
    'Capture a PNG screenshot of the primary display (when displayId is null/undefined) or a specific display id (0..2147483647).',
  inputSchema: schema,
  handler: async (input) => {
    const buffer = await screenshot(input.displayId ?? null)
    return { buffer, length: buffer.length }
  },
})