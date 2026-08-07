/**
 * MCP tool registry.
 *
 * ALL_TOOLS is the ordered array consumed by the MCP server (T4.2) to
 * register every tool with the protocol. Individual exports allow tests and
 * other modules to import a single tool without paying the file cost of the
 * full registry.
 *
 * Order is stable: it dictates the order tools appear in tool listings, so
 * keep it deterministic across releases.
 */
import { daScreenshot } from './screenshot.js'
import { daOcr } from './ocr.js'
import { daListDisplays } from './list-displays.js'
import { daWindowList } from './window-list.js'
import { daWindowFocus } from './window-focus.js'
import { daGetMousePosition } from './get-mouse-position.js'
import { daMoveMouse } from './move-mouse.js'
import { daClick } from './click.js'
import { daClickText } from './click-text.js'
import { daFindText } from './find-text.js'
import { daWaitForWindow } from './wait-for-window.js'
import { daWaitForText } from './wait-for-text.js'
import { daVerifyPixels } from './verify-pixels.js'
import { daDoubleClick } from './double-click.js'
import { daDrag } from './drag.js'
import { daDrawPath } from './draw-path.js'
import { daScroll } from './scroll.js'
import { daType } from './type.js'
import { daKey } from './key.js'
import { daLaunch } from './launch.js'
import type { McpToolDefinition } from './types.js'

export * from './types.js'

export const ALL_TOOLS: readonly McpToolDefinition[] = [
  daScreenshot,
  daOcr,
  daListDisplays,
  daWindowList,
  daWindowFocus,
  daWaitForWindow,
  daGetMousePosition,
  daMoveMouse,
  daClick,
  daClickText,
  daFindText,
  daWaitForText,
  daVerifyPixels,
  daDoubleClick,
  daDrag,
  daDrawPath,
  daScroll,
  daType,
  daKey,
  daLaunch,
]

export {
  daScreenshot,
  daOcr,
  daListDisplays,
  daWindowList,
  daWindowFocus,
  daWaitForWindow,
  daGetMousePosition,
  daMoveMouse,
  daClick,
  daClickText,
  daFindText,
  daWaitForText,
  daVerifyPixels,
  daDoubleClick,
  daDrag,
  daDrawPath,
  daScroll,
  daType,
  daKey,
  daLaunch,
}