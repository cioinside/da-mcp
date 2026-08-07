/**
 * Windows backend for `da_list_displays`: PowerShell + System.Windows.Forms.
 *
 * Screen.AllScreens is the only cross-build enumeration source that doesn't
 * require a native NAPI dep (which we deliberately dropped in #12/#13).
 * PowerShell ships on every supported Windows install; the call rate is
 * low (a few times per workflow), so the ~500ms per spawn is acceptable.
 *
 * The script emits one pipe-separated record per screen:
 *   `\\.\DISPLAY1|true|0,0,1920,1080`
 *
 * Scale-factor limitation: Windows supports per-monitor DPI v2 via
 * GetDpiForMonitor, but Screen.AllScreens does not expose it. We default
 * `scaleFactor = 1` for v1; a future enhancement can shell out a second
 * Add-Type call to surface it. Documented in the tool description.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { DisplayInfo } from '../platform/types.js'

// Wrap in `& { ... }` to prevent the param()/trailing-args binding bug
// (`powershell.exe -Command "<script>" arg1 arg2` concatenates trailing
// args to the LAST line, not to `param()`). See commit eed8282.
const WIN_LIST_DISPLAYS_PS1 = [
  '& {',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$screens = [System.Windows.Forms.Screen]::AllScreens',
  'foreach ($s in $screens) {',
  '  Write-Output "$($s.DeviceName)|$($s.Primary.ToString().ToLower())|$($s.Bounds.X),$($s.Bounds.Y),$($s.Bounds.Width),$($s.Bounds.Height)"',
  '}',
  '}',
].join('\n')

// Pure parser — no I/O, no side effects. Malformed lines are skipped
// silently. `id` is the zero-based index in Screen.AllScreens, so the
// downstream `screenshot-desktop screen: <id>` call hits the same display.
export function parsePowerShellScreens(stdout: string): DisplayInfo[] {
  const out: DisplayInfo[] = []
  let allScreensIndex = 0
  for (const line of stdout.split(/\r?\n/)) {
    if (line.length === 0) continue
    const currentIndex = allScreensIndex
    allScreensIndex += 1
    const parts = line.split('|')
    if (parts.length !== 3) continue
    const name = parts[0]
    const isPrimaryStr = parts[1]
    const rectStr = parts[2]
    if (name === undefined || isPrimaryStr === undefined || rectStr === undefined) continue
    if (isPrimaryStr !== 'true' && isPrimaryStr !== 'false') continue
    const rectParts = rectStr.split(',')
    if (rectParts.length !== 4) continue
    const xStr = rectParts[0]
    const yStr = rectParts[1]
    const wStr = rectParts[2]
    const hStr = rectParts[3]
    if (xStr === undefined || yStr === undefined || wStr === undefined || hStr === undefined) continue
    const x = Number.parseInt(xStr, 10)
    const y = Number.parseInt(yStr, 10)
    const w = Number.parseInt(wStr, 10)
    const h = Number.parseInt(hStr, 10)
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue
    if (!Number.isInteger(w) || !Number.isInteger(h)) continue
    if (w === 0 || h === 0) continue  // disconnected display
    out.push({
      id: currentIndex,
      name,
      isPrimary: isPrimaryStr === 'true',
      bounds: { x, y, width: w, height: h },
      scaleFactor: 1,
      rotation: 0,
    })
  }
  return out
}

export async function listDisplaysWindows(): Promise<DisplayInfo[]> {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', WIN_LIST_DISPLAYS_PS1],
    { shell: false, encoding: 'utf8' },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        'powershell.exe not found (Windows da_list_displays requires PowerShell — preinstalled on all supported Windows releases)',
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
  return parsePowerShellScreens(result.stdout ?? '')
}
