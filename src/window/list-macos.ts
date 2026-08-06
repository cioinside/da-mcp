/**
 * macOS backend for `listWindows`: spawn `osascript` with a System Events
 * script that walks every non-background-only process and its windows,
 * emitting one pipe-separated record per window: `id|pid|x,y,w,h|title`.
 *
 * AppleScript's `id of window` is a stable integer per window (per-process;
 * increments on reopen). We surface it as the cross-platform `hwnd`.
 *
 * Title may contain `|`, so the parser splits with `indexOf` rather than
 * `String.split('|')` — `split(..., 3)` would still mis-handle `|` in title.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { WindowInfo } from './types.js'

export function listWindowsMacos(): WindowInfo[] {
  const script = [
    'tell application "System Events"',
    '  set out to ""',
    '  repeat with p in (every process whose background only is false)',
    '    try',
    '      repeat with w in windows of p',
    '        set wId to id of w',
    '        set wName to name of w',
    '        set wPid to unix id of p',
    '        set wPos to position of w',
    '        set wSize to size of w',
    '        set out to out & wId & "|" & wPid & "|" & (item 1 of wPos) & "," & (item 2 of wPos) & "," & (item 1 of wSize) & "," & (item 2 of wSize) & "|" & wName & linefeed',
    '      end repeat',
    '    end try',
    '  end repeat',
    '  return out',
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
  const stdout = result.stdout ?? ''
  const out: WindowInfo[] = []
  for (const line of stdout.split('\n')) {
    if (line.length === 0) continue
    const firstPipe = line.indexOf('|')
    if (firstPipe < 0) continue
    const secondPipe = line.indexOf('|', firstPipe + 1)
    if (secondPipe < 0) continue
    const thirdPipe = line.indexOf('|', secondPipe + 1)
    if (thirdPipe < 0) continue
    const idStr = line.slice(0, firstPipe)
    const pidStr = line.slice(firstPipe + 1, secondPipe)
    const rectStr = line.slice(secondPipe + 1, thirdPipe)
    const title = line.slice(thirdPipe + 1)
    const hwnd = Number.parseInt(idStr, 10)
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
