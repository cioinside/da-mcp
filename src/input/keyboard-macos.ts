/**
 * macOS keyboard primitives — STUB for issue #13.
 *
 * See ./mouse-macos.ts for the deferral note. Real implementation lands
 * with #19 (osascript System Events + clipboard-paste Unicode fallback).
 */
import type { KeyName, Modifier } from '../platform/types.js'

function stub(what: string): never {
  throw new Error(
    `macOS ${what} is not implemented in #13 — use Windows SEA binary or ` +
      'build from source on Linux. Tracked by issue #19.',
  )
}

export function keyTapMac(_key: KeyName, _modifiers?: readonly Modifier[]): Promise<void> {
  return Promise.resolve(stub('keyTap'))
}
export function keyDownMac(_key: KeyName, _modifiers?: readonly Modifier[]): Promise<void> {
  return Promise.resolve(stub('keyDown'))
}
export function keyUpMac(_key: KeyName, _modifiers?: readonly Modifier[]): Promise<void> {
  return Promise.resolve(stub('keyUp'))
}
export function typeTextMac(_text: string): Promise<void> {
  return Promise.resolve(stub('typeText'))
}
