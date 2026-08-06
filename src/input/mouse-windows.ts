/**
 * Windows input primitives — PowerShell + user32!SetCursorPos / mouse_event.
 *
 * Each public function spawns `powershell.exe -NoProfile -NonInteractive
 * -Command -` with the script piped via stdin (avoids shell escaping).
 * Add-Type compiles the user32 P/Invoke once per call (~100-200ms); a
 * follow-up optimization can amortize this via a persistent PowerShell
 * process if measured too slow.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { MouseButton } from '../platform/types.js'

/** Spawn powershell.exe with `script` piped via stdin. Returns trimmed stdout. */
function runPs(script: string): string {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '-'],
    { shell: false, stdio: ['pipe', 'pipe', 'pipe'], input: Buffer.from(script, 'utf8') },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError('NATIVE_MISSING', 'powershell.exe not found on PATH')
    }
    throw new DaMcpError('NATIVE_FAILED', `powershell.exe failed: ${err.message}`, err)
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8') ?? ''
    throw new DaMcpError(
      'NATIVE_FAILED',
      `powershell.exe exited ${String(result.status)}: ${stderr}`,
    )
  }
  return (result.stdout?.toString('utf8') ?? '').trim()
}

const MOUSE_FLAGS: Readonly<Record<MouseButton, { readonly down: number; readonly up: number }>> = {
  left:   { down: 0x0002, up: 0x0004 },
  middle: { down: 0x0020, up: 0x0040 },
  right:  { down: 0x0008, up: 0x0010 },
  back:    { down: 0x0080, up: 0x0100 }, // XButton1 / XButton2
  forward: { down: 0x0100, up: 0x0080 }, // XButton2 / XButton1 (reverse pair)
}

export async function mouseMoveWindows(x: number, y: number): Promise<void> {
  runPs(
    `Add-Type -AssemblyName System.Windows.Forms\n` +
    `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${String(x)}, ${String(y)})\n`,
  )
}

export async function mouseClickWindows(button: MouseButton, count: number): Promise<void> {
  const flags = MOUSE_FLAGS[button]
  const lines: string[] = [
    `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }\\n"@`,
    `for ($i = 0; $i -lt ${String(count)}; $i++) {`,
    `  [M]::mouse_event(${String(flags.down)}, 0, 0, 0, 0)`,
    `  [M]::mouse_event(${String(flags.up)},   0, 0, 0, 0)`,
    `}`,
  ]
  runPs(lines.join('\n') + '\n')
}

export async function mouseDownWindows(button: MouseButton): Promise<void> {
  const flags = MOUSE_FLAGS[button]
  runPs(
    `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }\\n"@\n` +
    `[M]::mouse_event(${String(flags.down)}, 0, 0, 0, 0)\n`,
  )
}

export async function mouseUpWindows(button: MouseButton): Promise<void> {
  const flags = MOUSE_FLAGS[button]
  runPs(
    `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }\\n"@\n` +
    `[M]::mouse_event(${String(flags.up)}, 0, 0, 0, 0)\n`,
  )
}

export async function getMousePositionWindows(): Promise<{ x: number; y: number }> {
  const stdout = runPs(
    `Add-Type -AssemblyName System.Windows.Forms\n` +
    `$p = [System.Windows.Forms.Cursor]::Position\n` +
    `Write-Output ("{0} {1}" -f $p.X, $p.Y)\n`,
  )
  const parts = stdout.split(/\s+/)
  const x = Number(parts[0])
  const y = Number(parts[1])
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    throw new DaMcpError('NATIVE_FAILED', `could not parse Windows cursor position: '${stdout}'`)
  }
  return { x, y }
}