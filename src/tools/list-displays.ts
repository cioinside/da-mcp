/**
 * da_list_displays — enumerate connected displays.
 *
 * No input. Returns one DisplayInfo per physical/virtual display including
 * id, name, isPrimary, bounds, scaleFactor, rotation, and (when detectable)
 * refreshRateHz.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { listDisplays } from '../screenshot/index.js'

const schema = z.object({})

export const daListDisplays = defineTool({
  name: 'da_list_displays',
  description:
    'List connected displays with id, bounds, scale factor, rotation, and primary flag.',
  inputSchema: schema,
  handler: async () => {
    return await listDisplays()
  },
})