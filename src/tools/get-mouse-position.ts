/**
 * da_get_mouse_position — return the current OS cursor position as { x, y }.
 *
 * Routing is delegated to getMousePosition() in src/input/mouse.ts:
 *   Linux + X11     → xdotool getmouselocation --shell
 *   Linux + Wayland → ydotool getmouselocation
 *   macOS / Windows → @nut-tree-fork/nut-js mouse.getPosition()
 * In DA_MCP_TEST_MODE=mock the helper short-circuits to { x: 0, y: 0 } so
 * the tool remains safely callable from unit tests.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { getMousePosition } from '../input/index.js'

const schema = z.object({})

export const daGetMousePosition = defineTool({
  name: 'da_get_mouse_position',
  description: 'Return the current cursor position as { x, y } in screen coordinates.',
  inputSchema: schema,
  handler: async () => {
    return await getMousePosition()
  },
})