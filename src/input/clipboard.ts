/**
 * Clipboard helper for Unicode text input fallback on macOS / Windows.
 *
 * Linux xdotool handles Unicode natively via `xdotool type --clearmodifiers`,
 * so this helper is a no-op for that platform. On macOS + Windows, callers
 * write text to the clipboard and then send Cmd+V / Ctrl+V via the keyboard
 * path — `osascript keystroke` and `keybd_event` are both ASCII-only.
 *
 * Dispatch is per-OS; Linux returns immediately without side effects.
 */
import { spawnSync } from 'node:child_process'

/**
 * Write `text` to the OS clipboard. ASCII / non-ASCII safe.
 *
 * macOS: pipes through `pbcopy` (built-in). Stubs for #13; will become
 * a real pbcopy path in #19 (osascript fallback).
 * Windows: invokes PowerShell `Set-Clipboard -Value`. The script is piped
 * via stdin so non-ASCII characters pass through unchanged and shell
 * escaping is avoided.
 * Linux: no-op (xdotool handles Unicode natively).
 */
export function setClipboard(text: string, os: 'linux' | 'darwin' | 'win32'): void {
  if (os === 'linux') return
  if (os === 'darwin') {
    throw new Error(
      'macOS clipboard write via pbcopy not implemented in #13; tracked by #19',
    )
  }
  // Windows — PowerShell Set-Clipboard via stdin to avoid escaping issues.
  // -NoProfile: skip profile load (~100-500ms); -NonInteractive: no prompts.
  // The script reads its stdin and pipes it to Set-Clipboard verbatim.
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', '$input | Set-Clipboard'],
    {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: Buffer.from(text, 'utf8'),
    },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new Error('powershell.exe not found on PATH')
    }
    throw new Error(`powershell.exe failed to start: ${err.message}`)
  }
  if (result.status !== 0) {
    const stderr = result.stderr?.toString('utf8') ?? ''
    throw new Error(`Set-Clipboard exited with status ${String(result.status)}: ${stderr}`)
  }
}
