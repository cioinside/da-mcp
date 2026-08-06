/**
 * Windows keyboard primitives — PowerShell + user32!keybd_event.
 *
 * VK codes cover the same key set as the previous nutjs-based dispatcher
 * (the X11 names that `da_key` accepts — letters, digits, F1–F12, modifiers,
 * KeySym → nut.js Key enum); the conversion is replicated here so the
 * Windows path stays self-contained.
 *
 * Modifier semantics: hold modifier → press key → release key → release
 * modifier. This matches xdotool's `--clearmodifiers` behavior and
 * produces the same observable keystroke as the Linux + nut.js paths.
 *
 * Unicode text input is handled in the dispatcher via setClipboard +
 * Ctrl+V; see ./clipboard.ts. Per-character delay is best-effort in
 * paste mode.
 */
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import type { KeyName, Modifier } from '../platform/types.js'

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

/** Map MCP KeyName (X11 KeySym style) → VK byte. */
function toVK(name: string): number {
  if (name.length === 1 && /^[a-z]$/.test(name)) return name.toUpperCase().charCodeAt(0)
  if (name.length === 1 && /^[0-9]$/.test(name)) return name.charCodeAt(0)
  let n = name
  if (n === 'BackSpace') n = 'Backspace'
  else if (n === 'Num_Lock') n = 'NumLock'
  else if (n === 'Page_Up') n = 'PageUp'
  else if (n === 'Page_Down') n = 'PageDown'
  switch (n) {
    case 'Backspace': return 0x08
    case 'Tab':       return 0x09
    case 'Enter':
    case 'Return':    return 0x0D
    case 'Shift':     return 0x10
    case 'Control':
    case 'Ctrl':      return 0x11
    case 'Alt':       return 0x12
    case 'Escape':    return 0x1B
    case 'Space':     return 0x20
    case 'PageUp':    return 0x21
    case 'PageDown':  return 0x22
    case 'End':       return 0x23
    case 'Home':      return 0x24
    case 'Left':      return 0x25
    case 'Up':        return 0x26
    case 'Right':     return 0x27
    case 'Down':      return 0x28
    case 'Insert':    return 0x2D
    case 'Delete':    return 0x2E
    case 'NumLock':   return 0x90
    case 'ScrollLock': return 0x91
    case 'CapsLock':  return 0x14
    case 'Meta':
    case 'Super':     return 0x5B
    case 'F1':  return 0x70
    case 'F2':  return 0x71
    case 'F3':  return 0x72
    case 'F4':  return 0x73
    case 'F5':  return 0x74
    case 'F6':  return 0x75
    case 'F7':  return 0x76
    case 'F8':  return 0x77
    case 'F9':  return 0x78
    case 'F10': return 0x79
    case 'F11': return 0x7A
    case 'F12': return 0x7B
    default:
      throw new DaMcpError('INVALID_ARGUMENT', `unsupported key name '${name}'`)
  }
}

function toVKModifier(name: string): number {
  switch (name) {
    case 'ctrl':  return 0x11
    case 'shift': return 0x10
    case 'alt':   return 0x12
    case 'meta':
    case 'super': return 0x5B
    default:
      throw new DaMcpError(
        'INVALID_ARGUMENT',
        `unsupported modifier '${name}'; expected one of ctrl|alt|shift|meta|super`,
      )
  }
}

const ADD_TYPE_KEYBD = `Add-Type -TypeDefinition "@\\nusing System; using System.Runtime.InteropServices;\\npublic class K { [DllImport(\\"user32.dll\\")] public static extern void keybd_event(byte vk, byte sc, int flags, int extra); }\\n"@`

function pressKey(vk: number, up: boolean): string {
  return `[K]::keybd_event(${String(vk)}, 0, ${up ? 2 : 0}, 0)`
}

export async function keyTapWindows(
  key: KeyName,
  modifiers?: readonly Modifier[],
): Promise<void> {
  const mods = modifiers ?? []
  const lines: string[] = [ADD_TYPE_KEYBD]
  for (const m of mods) lines.push(pressKey(toVKModifier(m), false))
  lines.push(pressKey(toVK(key), false))
  lines.push(pressKey(toVK(key), true))
  for (const m of mods) lines.push(pressKey(toVKModifier(m), true))
  runPs(lines.join('\n') + '\n')
}

export async function keyDownWindows(
  key: KeyName,
  modifiers?: readonly Modifier[],
): Promise<void> {
  const mods = modifiers ?? []
  const lines: string[] = [ADD_TYPE_KEYBD]
  for (const m of mods) lines.push(pressKey(toVKModifier(m), false))
  lines.push(pressKey(toVK(key), false))
  runPs(lines.join('\n') + '\n')
}

export async function keyUpWindows(
  key: KeyName,
  modifiers?: readonly Modifier[],
): Promise<void> {
  const mods = modifiers ?? []
  const lines: string[] = [ADD_TYPE_KEYBD]
  lines.push(pressKey(toVK(key), true))
  for (const m of mods) lines.push(pressKey(toVKModifier(m), true))
  runPs(lines.join('\n') + '\n')
}

/** Per-character SendInput for ASCII text. Unicode is handled by the dispatcher via clipboard-paste. */
export async function typeAsciiWindows(text: string, perCharDelayMs: number): Promise<void> {
  if (text.length === 0) return
  const lines: string[] = [ADD_TYPE_KEYBD]
  for (const ch of text) {
    const vk = toVK(ch)
    lines.push(pressKey(vk, false))
    lines.push(pressKey(vk, true))
    if (perCharDelayMs > 0) lines.push(`Start-Sleep -Milliseconds ${String(perCharDelayMs)}`)
  }
  runPs(lines.join('\n') + '\n')
}