/**
 * da_window_focus — bring a top-level OS window to the foreground.
 *
 * Inputs:
 *   - `hwnd`:       integer (one of) — platform-specific window handle from
 *                   `da_window_list`. Exact match.
 *   - `title`:      string (one of) — case-insensitive substring match
 *                   against window title. First match wins; disambiguate
 *                   with `pid` if needed.
 *   - `pid`:        integer (optional) — narrow results to a single process.
 *   - `bringToTop`: boolean (default true) — also call SetWindowPos(HWND_TOP)
 *                   on Windows (no-op on macOS/Linux where the platform
 *                   equivalent of "raise" is folded into focus).
 *
 * Exactly one of `hwnd` or `title` is required. `pid` alone is not enough
 * to disambiguate (PID reuse is common on Windows).
 *
 * Returns `{ hwnd, pid, title, foreground }`. `foreground: false` means
 * the OS refused the foreground change (e.g. another process holds the
 * foreground lock on Windows); the window state still reflects the new
 * Z-order position when `bringToTop: true` was used.
 *
 * Throws `DaMcpError('NOT_FOUND')` when no visible window matches.
 * Throws `DaMcpError('NATIVE_MISSING')` when the platform CLI is missing.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { DaMcpError } from '../errors.js'
import { focusWindow, resolveWindow } from '../window/index.js'

const schema = z
  .object({
    hwnd: z.number().int().min(0).optional(),
    title: z.string().min(1).optional(),
    pid: z.number().int().min(0).optional(),
    bringToTop: z.boolean().default(true),
  })
  .refine((v) => v.hwnd !== undefined || v.title !== undefined, {
    message: 'either hwnd or title is required (pid alone cannot disambiguate)',
  })

export const daWindowFocus = defineTool({
  name: 'da_window_focus',
  description:
    'Bring a top-level OS window to the foreground so subsequent da_click / ' +
    'da_type / da_key land on it. Resolves the window either by `hwnd` ' +
    '(exact match) or by a case-insensitive substring of its `title` ' +
    '(optionally narrowed by `pid`). `bringToTop: true` (default) also calls ' +
    'SetWindowPos(HWND_TOP) on Windows so the window is at the top of the ' +
    'Z-order. Returns `{ hwnd, pid, title, foreground }` where `foreground: ' +
    'false` indicates the OS refused the foreground change (e.g. another ' +
    'process holds the foreground lock on Windows). Throws NOT_FOUND when no ' +
    'visible window matches. Linux requires `wmctrl` on PATH; macOS uses ' +
    '`osascript`; Windows uses PowerShell + Win32 SetForegroundWindow.',
  inputSchema: schema,
  handler: async (input) => {
    const target = resolveWindow({
      ...(input.hwnd !== undefined && { hwnd: input.hwnd }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.pid !== undefined && { pid: input.pid }),
    })
    if (target === null) {
      throw new DaMcpError(
        'NOT_FOUND',
        `No visible top-level window matched (hwnd=${String(input.hwnd)}, ` +
          `title=${JSON.stringify(input.title)}, pid=${String(input.pid)})`,
      )
    }
    return await focusWindow(
      target.hwnd,
      target.title,
      target.pid,
      input.bringToTop,
    )
  },
})