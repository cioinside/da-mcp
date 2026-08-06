/**
 * Linux backend for `listWindows`: shell out to `wmctrl -l -p -G` and parse
 * the pipe-separated record format into WindowInfo.
 *
 * Output format (whitespace-separated, title is everything from token 8 onward):
 *   0x00XXXXXX  desktop  PID  X  Y  W  H  host  Title...
 *
 * Example:
 *   0x04000007  0  1234  0  0  1920  1080  myhost  Visual Studio Code
 *
 * `Number.parseInt(hexStr, 16)` converts the HWND hex to a plain integer so the
 * shape is identical across OSes. Visible-only is implicit — `wmctrl -l` only
 * enumerates mapped (non-withdrawn) windows.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { WindowInfo } from './types.js'

export function listWindowsLinux(wmctrlAvailable: boolean): WindowInfo[] {
  if (!wmctrlAvailable) {
    throw new DaMcpError(
      'NATIVE_MISSING',
      'wmctrl is not installed (Linux da_window_list requires wmctrl on PATH; install via your package manager or rerun scripts/install-system-deps.sh)',
    )
  }
  const result = spawnSync('wmctrl', ['-l', '-p', '-G'], {
    shell: false,
    encoding: 'utf8',
  })
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        'wmctrl binary disappeared mid-call (was it uninstalled?)',
      )
    }
    throw new DaMcpError('NATIVE_FAILED', 'wmctrl failed to start', err)
  }
  if (result.status !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `wmctrl exited with status ${String(result.status)}: ${result.stderr ?? ''}`,
    )
  }
  const stdout = result.stdout ?? ''
  const out: WindowInfo[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const parts = line.split(/\s+/)
    if (parts.length < 8) continue
    const hwndHex = parts[0]
    if (typeof hwndHex !== 'string' || hwndHex.length === 0) continue
    const hwnd = Number.parseInt(hwndHex, 16)
    if (!Number.isInteger(hwnd) || hwnd <= 0) continue
    const pid = Number.parseInt(parts[2] ?? '0', 10)
    const x = Number.parseInt(parts[3] ?? '0', 10)
    const y = Number.parseInt(parts[4] ?? '0', 10)
    const w = Number.parseInt(parts[5] ?? '0', 10)
    const h = Number.parseInt(parts[6] ?? '0', 10)
    const title = parts.slice(7).join(' ').trim()
    out.push({
      hwnd,
      pid: Number.isFinite(pid) ? pid : 0,
      title,
      rect: {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
        width: Number.isFinite(w) ? w : 0,
        height: Number.isFinite(h) ? h : 0,
      },
      isVisible: true,
    })
  }
  return out
}
