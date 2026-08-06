/**
 * Windows scroll primitive — PowerShell + user32!mouse_event WHEEL.
 *
 * Windows WHEEL delta: positive = scroll up (toward top of document),
 * negative = scroll down. The MCP convention is positive dy = scroll
 * down, so we negate.
 *
 * Horizontal scroll: HWHEEL = 0x1000; positive dx = scroll right, kept
 * as-is (already aligned with MCP convention).
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'

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

export async function mouseScrollWindows(dx: number, dy: number, stepPx: number): Promise<void> {
  const absDy = Math.abs(Math.trunc(dy / stepPx))
  const absDx = Math.abs(Math.trunc(dx / stepPx))
  // WHEEL = 0x0800; HWHEEL = 0x1000. dy positive → scroll DOWN → negative wheel delta.
  // dx positive → scroll RIGHT → positive hwheel delta.
  const dyLines: string[] = []
  if (dy !== 0) {
    const delta = dy > 0 ? -absDy : absDy
    dyLines.push(
      `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }\\n"@`,
    )
    for (let i = 0; i < absDy; i++) {
      dyLines.push(`[M]::mouse_event(0x0800, 0, 0, ${String(delta)}, 0)`)
    }
  }
  const dxLines: string[] = []
  if (dx !== 0) {
    const delta = dx > 0 ? absDx : -absDx
    if (dy === 0) {
      dxLines.push(
        `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int dx, int dy, int d, int e); }\\n"@`,
      )
    }
    for (let i = 0; i < absDx; i++) {
      dxLines.push(`[M]::mouse_event(0x1000, 0, 0, ${String(delta)}, 0)`)
    }
  }
  runPs([...dyLines, ...dxLines].join('\n') + '\n')
}