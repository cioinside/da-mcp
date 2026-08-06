/**
 * Keyboard operations: keyTap / keyDown / keyUp / typeText.
 *
 * Routing per OS+display server:
 *   Linux + X11     → xdotool CLI
 *   Linux + Wayland → ydotool CLI (keyboard + mouse, unified)
 *   Linux + Wayland + typeText → wtype CLI
 *   macOS / Windows → @nut-tree-fork/nut-js (libnut native, statically imported)
 *   unknown         → throw DaMcpError('NATIVE_MISSING')
 *
 * All spawnSync calls use shell:false. text containing NUL is rejected
 * defensively (the CLI tools handle metacharacters differently); oversize
 * text is rejected by getConfig().maxTypeBytes.
 *
 * Helpers (runCli, resolveRouting, requireTool, isMockMode) are reused
 * from ./routing.js to keep dispatch uniform.
 */

import { keyboard, Key } from '@nut-tree-fork/nut-js'
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

/** Build a chord string for xdotool/ydotool: ['ctrl', 'shift'] + 'a' → 'ctrl+shift+a'. */
function buildChord(key: KeyName, modifiers: readonly Modifier[]): string {
  if (modifiers.length === 0) return key
  return [...modifiers, key].join('+')
}

/**
 * Map MCP modifier names (per the JSON-Schema enum in src/platform/types.ts)
 * to nut.js Key enum values. nut.js exposes LeftControl / LeftShift / LeftAlt
 * / LeftMeta / LeftSuper — pick the "left" variant so subsequent Right* keys
 * don't desync the modifier state on chord presses.
 *
 * Exported for unit tests; not part of the public input API.
 */
export function toNutModifier(name: string): Key {
  switch (name) {
    case 'ctrl': return Key.LeftControl
    case 'alt': return Key.LeftAlt
    case 'shift': return Key.LeftShift
    case 'meta': return Key.LeftMeta
    case 'super': return Key.LeftSuper
    default:
      throw new DaMcpError(
        'INVALID_ARGUMENT',
        `unsupported modifier '${name}'; expected one of ctrl|alt|shift|meta|super`,
      )
  }
}

/**
 * Normalize MCP key names (X11-style per src/platform/types.ts KeyName
 * comment) to nut.js Key enum members and look them up. Handles the few
 * X11 names that differ from nut.js casing and the per-character mapping
 * for letters + digits. Throws INVALID_ARGUMENT on unknown names.
 *
 * Exported for unit tests; not part of the public input API.
 */
export function toNutKey(name: string): Key {
  let normalized = name
  if (name === 'BackSpace') {
    normalized = 'Backspace'
  } else if (name === 'Num_Lock') {
    normalized = 'NumLock'
  } else if (name === 'Page_Up') {
    normalized = 'PageUp'
  } else if (name === 'Page_Down') {
    normalized = 'PageDown'
  } else if (name.length === 1 && /^[0-9]$/.test(name)) {
    normalized = `Num${name}`
  } else if (name.length === 1 && /^[a-z]$/.test(name)) {
    normalized = name.toUpperCase()
  } else if (name.length === 0) {
    throw new DaMcpError('INVALID_ARGUMENT', 'unsupported key name \'\'')
  }
  if (normalized in Key) {
    return Key[normalized as keyof typeof Key]
  }
  throw new DaMcpError('INVALID_ARGUMENT', `unsupported key name '${name}'`)
}

export async function keyTap(
  key: KeyName,
  modifiers?: readonly Modifier[],
  opts?: KeyOptions,
): Promise<void> {
  const mods = modifiers ?? []
  void opts
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  const chord = buildChord(key, mods)

  // Optional hold-then-release path (only when no modifiers, for V1 simplicity).
  const holdMs = opts?.holdMs ?? 0
  if (holdMs > 0 && mods.length === 0) {
    await keyDown(key)
    await new Promise<void>((resolve) => setTimeout(resolve, holdMs))
    await keyUp(key)
    return
  }

  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['key', '--clearmodifiers', chord])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    runCli('ydotool', ['key', chord])
    return
  }
  // macOS / Windows — @nut-tree-fork/nut-js.
  // pressKey / releaseKey accept modifier+key as separate positional args.
  const modKeys = mods.map(toNutModifier)
  const rkey = toNutKey(key)
  await keyboard.pressKey(...modKeys, rkey)
  await keyboard.releaseKey(...modKeys, rkey)
}

export async function keyDown(key: KeyName): Promise<void> {
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['keydown', key])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    runCli('ydotool', ['keydown', key])
    return
  }
  // macOS / Windows
  await keyboard.pressKey(toNutKey(key))
}

export async function keyUp(key: KeyName): Promise<void> {
  if (isMockMode()) return
  const routing = resolveRouting()
  const info = detectPlatform()
  if (routing.os === 'linux' && routing.display === 'x11') {
    requireTool(info.tools, 'xdotool', routing)
    runCli('xdotool', ['keyup', key])
    return
  }
  if (routing.os === 'linux' && routing.display === 'wayland') {
    requireTool(info.tools, 'ydotool', routing)
    runCli('ydotool', ['keyup', key])
    return
  }
  // macOS / Windows
  await keyboard.releaseKey(toNutKey(key))
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
  // macOS / Windows — nut.js exposes per-character delay via
  // keyboard.config.autoDelayMs. Set + restore around the call so concurrent
  // callers don't observe each other's delay settings.
  const prev = keyboard.config.autoDelayMs
  keyboard.config.autoDelayMs = perCharDelayMs
  try {
    await keyboard.type(text)
  } finally {
    keyboard.config.autoDelayMs = prev
  }
}