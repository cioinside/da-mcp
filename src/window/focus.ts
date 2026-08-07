/**
 * Cross-platform window focusing: bring a top-level window to the foreground.
 *
 *   Linux   → wmctrl -i -a <HWND> (+ -i -R to also raise Z-order)
 *   macOS   → osascript with System Events (perform action "AXRaise" on window)
 *   Windows → PowerShell + Add-Type + user32!SetForegroundWindow (+ SetWindowPos)
 *
 * On every platform `foreground: true` means the OS honoured the request. On
 * Windows and macOS, SetForegroundWindow can be refused if another process holds
 * the foreground lock — we surface that as `foreground: false` rather than
 * throwing, because the Z-order change still applied.
 *
 * In DA_MCP_TEST_MODE=mock returns the input hwnd with foreground=true so
 * downstream tests can assert on it without spawning native binaries.
 */
import { spawnSync } from 'node:child_process'
import { isMockMode } from '../input/routing.js'
import { detectPlatform } from '../platform/detect.js'
import { DaMcpError } from '../errors.js'
import type { FocusResult } from './types.js'

export function focusWindow(
  hwnd: number,
  title: string,
  pid: number,
  bringToTop: boolean,
): FocusResult {
  if (!Number.isInteger(hwnd) || hwnd <= 0) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `hwnd must be a positive integer; got ${String(hwnd)}`,
    )
  }
  if (isMockMode()) {
    return { hwnd, pid, title, foreground: true }
  }
  const info = detectPlatform()
  switch (info.os) {
    case 'linux':
      return focusWindowLinux(info.tools.wmctrl, hwnd, title, pid, bringToTop)
    case 'darwin':
      return focusWindowMacos(hwnd, title, pid, bringToTop)
    case 'win32':
      return focusWindowWindows(hwnd, title, pid, bringToTop)
    default:
      throw new DaMcpError(
        'UNSUPPORTED_PLATFORM',
        `window focusing is not supported on os='${info.os}'`,
      )
  }
}

// ─── Linux: wmctrl -i -a <HWND-hex> [-i -R for raise+Z-order] ────────────────

function focusWindowLinux(
  wmctrlAvailable: boolean,
  hwnd: number,
  title: string,
  pid: number,
  bringToTop: boolean,
): FocusResult {
  if (!wmctrlAvailable) {
    throw new DaMcpError(
      'NATIVE_MISSING',
      'wmctrl is not installed (Linux da_window_focus requires wmctrl on PATH)',
    )
  }
  const hexHwnd = `0x${hwnd.toString(16)}`
  // -i treats the HWND argument as a numeric id (not a title substring).
  // -R raises AND moves focus (vs -a which only activates).
  const cmd = bringToTop ? '-R' : '-a'
  const result = spawnSync('wmctrl', ['-i', cmd, hexHwnd], {
    shell: false,
    encoding: 'utf8',
  })
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError('NATIVE_MISSING', 'wmctrl binary disappeared mid-call')
    }
    throw new DaMcpError('NATIVE_FAILED', 'wmctrl failed to start', err)
  }
  // wmctrl -i -a returns 0 on success; non-zero means the HWND isn't valid
  // or the window manager refused (e.g. focus-stealing prevention on Wayland).
  const ok = result.status === 0
  if (!ok) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `wmctrl -i ${cmd} ${hexHwnd} exited with status ${String(result.status)}: ${result.stderr ?? ''}`,
    )
  }
  return { hwnd, pid, title, foreground: true }
}

// ─── macOS: osascript + System Events ───────────────────────────────────────
//
// `tell process "X" to perform action "AXRaise" of window "Y"` does the
// equivalent of SetForegroundWindow. macOS does not have a separate bringToTop
// parameter — AXRaise handles both raise and focus as one operation.
//
// AppleScript's `id of window` is the integer we accept as `hwnd`. We map it
// back to a window via `tell application "System Events" to get id of windows
// of (first process whose windows contains window id N)` — but System Events
// does not expose a direct `window id N` lookup. Instead we walk every visible
// process's windows, match by id, and perform AXRaise on the matching window.

function focusWindowMacos(
  hwnd: number,
  title: string,
  pid: number,
  _bringToTop: boolean,
): FocusResult {
  const script = [
    'tell application "System Events"',
    '  repeat with p in (every process whose background only is false)',
    '    try',
    '      repeat with w in windows of p',
    '        if (id of w) = ' + String(hwnd) + ' then',
    '          perform action "AXRaise" of w',
    '          return "ok"',
    '        end if',
    '      end repeat',
    '    end try',
    '  end repeat',
    '  return "not_found"',
    'end tell',
  ].join('\n')
  const result = spawnSync('osascript', ['-e', script], {
    shell: false,
    encoding: 'utf8',
  })
  if (result.error !== null && result.error !== undefined) {
    throw new DaMcpError('NATIVE_FAILED', 'osascript failed to start', result.error)
  }
  if (result.status !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `osascript exited with status ${String(result.status)}: ${result.stderr ?? ''}`,
    )
  }
  const stdout = (result.stdout ?? '').trim()
  if (stdout === 'not_found') {
    throw new DaMcpError(
      'NOT_FOUND',
      `no visible window with hwnd=${String(hwnd)} on macOS`,
    )
  }
  return { hwnd, pid, title, foreground: true }
}

// ─── Windows: PowerShell + Add-Type + user32!SetForegroundWindow ────────────

// Wrap in `& { ... }`: PowerShell `-Command "<script>" arg1 arg2` would
// otherwise concatenate trailing args to the LAST line, not to `param()`.
export const WIN_FOCUS_SCRIPT = [
  'param([Int64]$h, [bool]$bringToTop)',
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Runtime.InteropServices;',
  'public class WinFocus {',
  '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
  '  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr ins, int x, int y, int cx, int cy, uint flags);',
  '  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);',
  '  public static int Focus(IntPtr h, bool bringToTop) {',
  '    bool ok;',
  '    if (bringToTop) {',
  '      ShowWindow(h, 9);', // SW_RESTORE — unminimize if minimized
  '      // SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW = 0x0003',
  '      SetWindowPos(h, IntPtr.Zero, 0, 0, 0, 0, 0x0003);',
  '    }',
  '    ok = SetForegroundWindow(h);',
  '    return ok ? 1 : 0;',
  '  }',
  '}',
  '"@ -ErrorAction SilentlyContinue',
  '[WinFocus]::Focus([IntPtr]$h, $bringToTop)',
].join('\n')
export const WIN_FOCUS_PS1 = `& { ${WIN_FOCUS_SCRIPT} }`

function focusWindowWindows(
  hwnd: number,
  title: string,
  pid: number,
  bringToTop: boolean,
): FocusResult {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      WIN_FOCUS_PS1,
      '-h',
      String(hwnd),
      '-bringToTop',
      bringToTop ? '$true' : '$false',
    ],
    { shell: false, encoding: 'utf8' },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        'powershell.exe not found (Windows da_window_focus requires PowerShell)',
      )
    }
    throw new DaMcpError('NATIVE_FAILED', 'powershell failed to start', err)
  }
  if (result.status !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `powershell exited with status ${String(result.status)}: ${result.stderr ?? ''}`,
    )
  }
  // Script writes "1" on success, "0" on refused foreground change.
  const stdout = (result.stdout ?? '').trim()
  const foreground = stdout === '1'
  return { hwnd, pid, title, foreground }
}
