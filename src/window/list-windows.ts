/**
 * Windows backend for `listWindows`: PowerShell + Add-Type + user32!EnumWindows.
 *
 * Why PowerShell here, not koffi:
 *   The rest of da-mcp shed its native-binding dep (robotjs) in commit 46f347c
 *   specifically to avoid NAPI build/toolchain issues. Adding koffi for one
 *   Win32-only tool would re-introduce the very problem we just removed.
 *   PowerShell ships on every supported Windows install and the call rate is
 *   low (a few times per workflow), so the ~500ms per spawn is acceptable.
 *
 * The script loads a tiny C# class via Add-Type that P/Invokes user32
 * (EnumWindows, IsWindowVisible, GetWindowTextW, GetWindowThreadProcessId,
 * GetWindowRect), filters to visible windows only, and emits one
 * pipe-separated record per window: `hwnd|pid|x,y,w,h|title`.
 *
 * We pass the script as a single string via `-Command` (PowerShell accepts
 * inline scripts that way; no temp-file round-trip needed).
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { WindowInfo } from './types.js'

const WIN_LIST_PS1 = [
  'Add-Type -TypeDefinition @"',
  'using System;',
  'using System.Collections.Generic;',
  'using System.Runtime.InteropServices;',
  'using System.Text;',
  'public class WinList {',
  '  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
  '  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);',
  '  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
  '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder sb, int n);',
  '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
  '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }',
  '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);',
  '  public static List<string> List() {',
  '    var list = new List<string>();',
  '    EnumWindows((h, l) => {',
  '      if (!IsWindowVisible(h)) return true;',
  '      var sb = new StringBuilder(512);',
  '      GetWindowTextW(h, sb, sb.Capacity);',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      RECT r; GetWindowRect(h, out r);',
  '      list.Add(((long)h).ToString() + "|" + pid + "|" + r.L + "," + r.T + "," + (r.R-r.L) + "," + (r.B-r.T) + "|" + sb);',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return list;',
  '  }',
  '}',
  '"@ -ErrorAction SilentlyContinue',
  '[WinList]::List()',
].join('\n')

export function listWindowsWindows(): WindowInfo[] {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST_PS1],
    { shell: false, encoding: 'utf8' },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        'powershell.exe not found (Windows da_window_list requires PowerShell — preinstalled on all supported Windows releases)',
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
  const stdout = result.stdout ?? ''
  const out: WindowInfo[] = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) continue
    const firstPipe = line.indexOf('|')
    if (firstPipe < 0) continue
    const secondPipe = line.indexOf('|', firstPipe + 1)
    if (secondPipe < 0) continue
    const thirdPipe = line.indexOf('|', secondPipe + 1)
    if (thirdPipe < 0) continue
    const hwndStr = line.slice(0, firstPipe)
    const pidStr = line.slice(firstPipe + 1, secondPipe)
    const rectStr = line.slice(secondPipe + 1, thirdPipe)
    const title = line.slice(thirdPipe + 1)
    const hwnd = Number.parseInt(hwndStr, 10)
    const pid = Number.parseInt(pidStr, 10)
    if (!Number.isInteger(hwnd) || !Number.isInteger(pid)) continue
    const rectParts = rectStr.split(',')
    if (rectParts.length !== 4) continue
    const x = Number.parseInt(rectParts[0] ?? '0', 10)
    const y = Number.parseInt(rectParts[1] ?? '0', 10)
    const w = Number.parseInt(rectParts[2] ?? '0', 10)
    const h = Number.parseInt(rectParts[3] ?? '0', 10)
    out.push({
      hwnd,
      pid,
      title,
      rect: { x, y, width: w, height: h },
      isVisible: true,
    })
  }
  return out
}
