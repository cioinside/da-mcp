/**
 * Keyboard operations: keyTap / keyDown / keyUp / typeText.
 *
 * Routing per OS+display server:
 *   Linux + X11     → xdotool CLI
 *   Linux + Wayland → ydotool CLI (keyboard + mouse, unified)
 *   Linux + Wayland + typeText → wtype CLI
 *   macOS / Windows → robotjs (native, lazy-loaded)
 *   unknown         → throw DaMcpError('NATIVE_MISSING')
 *
 * All spawnSync calls use shell:false. text containing NUL is rejected
 * defensively (the CLI tools handle metacharacters differently); oversize
 * text is rejected by getConfig().maxTypeBytes.
 *
 * Helpers (runCli, resolveRouting, requireTool, loadRobotjs, isMockMode)
 * are reused from ./routing.js to keep dispatch uniform.
 */

import { getConfig } from '../config.js'
import { DaMcpError } from '../errors.js'
import { detectPlatform } from '../platform/detect.js'
import type { KeyName, Modifier } from '../platform/types.js'
import type { KeyOptions, TypeOptions } from './types.js'
import {
  isMockMode,
  loadRobotjs,
  requireTool,
  resolveRouting,
  runCli,
} from './routing.js'

/** Build a chord string for xdotool/ydotool: ['ctrl', 'shift'] + 'a' → 'ctrl+shift+a'. */
function buildChord(key: KeyName, modifiers: readonly Modifier[]): string {
  if (modifiers.length === 0) return key
  return [...modifiers, key].join('+')
}

/** Map MCP modifier names (per the JSON-Schema enum) to robotjs's expected flag names.
 * robotjs rejects 'ctrl' as "Invalid key flag specified" — it expects 'control'.
 * Exported for unit tests; not part of the public input API.
 */
export function toRobotjsModifier(name: string): string {
  switch (name) {
    case 'ctrl':
      return 'control'
    case 'meta':
      return 'command'
    default:
      return name
  }
}

/** Convert robotjs modifier + key into a single chord string. robotjs.keyTap accepts them as separate args. */
function robotjsModifierArgs(modifiers: readonly Modifier[]): readonly string[] | undefined {
  if (modifiers.length === 0) return undefined
  return modifiers.map(toRobotjsModifier)
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
  // macOS / Windows
  const robotjs = await loadRobotjs()
  const modArg = robotjsModifierArgs(mods)
  if (modArg === undefined) {
    robotjs.keyTap(key)
  } else {
    // robotjs.keyTap takes each modifier as a separate positional arg
    // (not an array — passing an array raises "Invalid key flag specified").
    robotjs.keyTap(key, ...modArg)
  }
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
  const robotjs = await loadRobotjs()
  robotjs.keyToggle(key, 'down')
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
  const robotjs = await loadRobotjs()
  robotjs.keyToggle(key, 'up')
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
  // macOS / Windows — robotjs.typeStringDelayed expects chars-per-minute.
  const robotjs = await loadRobotjs()
  if (perCharDelayMs <= 0) {
    robotjs.typeString(text)
  } else {
    const cpm = 60_000 / perCharDelayMs
    robotjs.typeStringDelayed(text, cpm)
  }
}
