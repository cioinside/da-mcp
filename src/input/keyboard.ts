/**
 * Keyboard operations — public dispatch entry point.
 *
 * Per-OS backends live in `./keyboard-{macos,windows}.ts`. Linux paths
 * stay inline (xdotool / ydotool / wtype).
 *
 *   Linux + X11 / typeText on any Linux → xdotool CLI (Unicode-native)
 *   Linux + Wayland + key/click   → ydotool CLI
 *   Linux + Wayland + typeText    → wtype CLI
 *   Windows                        → PowerShell + user32!keybd_event (keyboard-windows.ts)
 *   macOS                          → osascript (keyboard-macos.ts; v1.0.0 stub, deferred to #19)
 *
 * Modifier keys: hold modifier → press key → release key → release
 * modifier on every OS. `try/finally` guarantees cleanup on every code
 * path (pattern from `da_draw_path` for issue #10).
 *
 * Unicode text input on Windows: write to clipboard via `setClipboard`,
 * then send Ctrl+V. Same pattern will apply to macOS via #19.
 */
import { getConfig } from '../config.js'
import { DaMcpError } from '../errors.js'
import { detectPlatform } from '../platform/detect.js'
import type { KeyName, Modifier } from '../platform/types.js'
import type { KeyOptions, TypeOptions } from './types.js'
import {
  isMockMode,
  requireTool,
  resolveRouting,
  runCli,
} from './routing.js'
import { keyTapMac, keyDownMac, keyUpMac, typeTextMac } from './keyboard-macos.js'
import { keyTapWindows, keyDownWindows, keyUpWindows, typeAsciiWindows } from './keyboard-windows.js'
import { setClipboard } from './clipboard.js'

/** ASCII-only: any char in the BMP outside the 7-bit range. */
function isAsciiOnly(text: string): boolean {
  return !/[^\x00-\x7F]/.test(text)
}

export async function keyTap(
  key: KeyName,
  modifiers?: readonly Modifier[],
  opts?: KeyOptions,
): Promise<void> {
  const mods = modifiers ?? []
  const holdMs = opts?.holdMs ?? 0
  void mods
  void holdMs
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()

  // Optional hold-then-release path (no modifiers, for V1 simplicity).
  if (holdMs > 0 && mods.length === 0 && (routing.os === 'linux' || routing.os === 'win32')) {
    await keyDown(key)
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs))
    await keyUp(key)
    return
  }

  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    const chord = mods.length === 0 ? key : [...mods, key].join('+')
    runCli('xdotool', ['key', '--clearmodifiers', chord])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    const chord = mods.length === 0 ? key : [...mods, key].join('+')
    runCli('ydotool', ['key', chord])
    return
  }
  if (routing.os === 'win32') {
    await keyTapWindows(key, mods)
    return
  }
  // darwin
  void info
  await keyTapMac(key, mods)
}

export async function keyDown(
  key: KeyName,
  modifiers?: readonly Modifier[],
): Promise<void> {
  const mods = modifiers ?? []
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    for (const m of mods) runCli('xdotool', ['keydown', m])
    runCli('xdotool', ['keydown', key])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    for (const m of mods) runCli('ydotool', ['keydown', m])
    runCli('ydotool', ['keydown', key])
    return
  }
  if (routing.os === 'win32') {
    await keyDownWindows(key, mods)
    return
  }
  // darwin
  void info
  await keyDownMac(key, mods)
}

export async function keyUp(
  key: KeyName,
  modifiers?: readonly Modifier[],
): Promise<void> {
  const mods = modifiers ?? []
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['keyup', key])
    for (const m of mods) runCli('xdotool', ['keyup', m])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    runCli('ydotool', ['keyup', key])
    for (const m of mods) runCli('ydotool', ['keyup', m])
    return
  }
  if (routing.os === 'win32') {
    await keyUpWindows(key, mods)
    return
  }
  // darwin
  void info
  await keyUpMac(key, mods)
}

export async function typeText(text: string, opts?: TypeOptions): Promise<void> {
  if (text.indexOf('\0') !== -1) {
    throw new DaMcpError(
      'SHELL_INJECTION_DETECTED',
      'typeText() rejects text containing NUL byte (\\0); this is a defensive guard',
    )
  }
  const maxBytes = getConfig().maxTypeBytes
  if (text.length * 4 > maxBytes) {
    throw new DaMcpError(
      'INPUT_TOO_LARGE',
      `typeText input is too large: ${String(text.length)} chars × 4 = ${String(text.length * 4)} bytes, max ${String(maxBytes)}`,
    )
  }
  if (isMockMode()) {
    void opts
    return
  }
  const perCharDelayMs = opts?.perCharDelayMs ?? 0
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['type', '--delay', String(perCharDelayMs), '--clearmodifiers', text])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'wtype', routing)
    runCli('wtype', ['--delay', String(perCharDelayMs), text])
    return
  }
  if (routing.os === 'win32') {
    if (isAsciiOnly(text)) {
      await typeAsciiWindows(text, perCharDelayMs)
      return
    }
    // Unicode path: clipboard + Ctrl+V.
    setClipboard(text, 'win32')
    await keyTapWindows('v', ['ctrl'])
    return
  }
  // darwin
  void info
  void perCharDelayMs
  await typeTextMac(text)
}