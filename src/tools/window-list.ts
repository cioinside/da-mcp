/**
 * da_window_list — enumerate visible top-level OS windows.
 *
 * No input. Returns an array of `WindowInfo` records (hwnd, pid, title,
 * rect, isVisible). Backed by `wmctrl -l -p -G` on Linux, `osascript` +
 * System Events on macOS, and PowerShell + `user32!EnumWindows` on Windows.
 *
 * `hwnd` is the platform-specific window handle (Windows HWND, X11 window id
 * printed as `0xNNNNNNNN` by wmctrl, AppleScript window id). It is a stable
 * integer for the lifetime of the window and can be passed to `da_window_focus`.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { listWindows } from '../window/index.js'

const schema = z.object({})

export const daWindowList = defineTool({
  name: 'da_window_list',
  description:
    'List all visible top-level OS windows. Returns one WindowInfo per window ' +
    'with `hwnd` (platform-specific integer handle), `pid` (owning process id), ' +
    '`title`, `rect` (x/y/width/height), and `isVisible`. The `hwnd` can be ' +
    'passed to `da_window_focus` to bring the window to the foreground. ' +
    'Linux requires `wmctrl` on PATH; macOS uses `osascript`; Windows uses ' +
    'PowerShell + Win32 EnumWindows.',
  inputSchema: schema,
  handler: async () => {
    return await listWindows()
  },
})