/**
 * macOS input primitives — STUB for issue #13.
 *
 * Real implementation deferred to issue #19 (osascript System Events path).
 * For v1.0.0 Windows-only build, these stubs throw so callers fail fast
 * with a clear error message rather than silently no-op'ing.
 *
 * When implementing #19, replace these stubs with osascript invocations:
 *   click     → `tell application "System Events" to click at {x, y}`
 *   scroll    → `cliclick` if available, else throw NATIVE_MISSING
 *   mouseDown/Up → `cliclick` if available, else throw NATIVE_MISSING
 *   key       → `tell application "System Events" to key code N using {...}`
 *   typeText  → `keystroke` (ASCII) or clipboard paste (Unicode)
 */
import type { MouseButton } from '../platform/types.js'

function stub(what: string): never {
  throw new Error(
    `macOS ${what} is not implemented in #13 — use Windows SEA binary or ` +
      'build from source on Linux. Tracked by issue #19.',
  )
}

export function mouseMoveMac(_x: number, _y: number): Promise<void> {
  return Promise.resolve(stub('mouseMove'))
}
export function mouseClickMac(_button: MouseButton, _count: number): Promise<void> {
  return Promise.resolve(stub('mouseClick'))
}
export function mouseDownMac(_button: MouseButton): Promise<void> {
  return Promise.resolve(stub('mouseDown'))
}
export function mouseUpMac(_button: MouseButton): Promise<void> {
  return Promise.resolve(stub('mouseUp'))
}
export function getMousePositionMac(): Promise<{ x: number; y: number }> {
  return Promise.resolve(stub('getMousePosition'))
}
