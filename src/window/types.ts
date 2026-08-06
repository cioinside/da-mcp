/**
 * Cross-platform OS-level window identifiers.
 *
 * `hwnd` is a platform-specific integer pointer-shaped value:
 *   Windows → HWND (native window handle from user32)
 *   Linux   → X11 window id (printed as `0xNNNNNNNN` by `wmctrl -l` —
 *             consumers should pass the decimal form here, not the hex)
 *   macOS   → AppleScript window id (System Events `id of window`)
 *
 * All three are integers; any cross-platform consumer should treat the value
 * as opaque. `pid` is the owning process id (OS-portable).
 */
export interface WindowInfo {
  hwnd: number
  pid: number
  title: string
  rect: { x: number; y: number; width: number; height: number }
  isVisible: boolean
}

/**
 * Result of `focusWindow`. `foreground: false` means Windows (or macOS / a
 * Wayland compositor) refused the foreground change — typically because
 * another process holds the foreground lock. The window state still reflects
 * the new Z-order position when `bringToTop` was used.
 */
export interface FocusResult {
  hwnd: number
  pid: number
  title: string
  foreground: boolean
}

/**
 * Window-resolver inputs. Pass `hwnd` (exact match) or `title` (case-insensitive
 * substring). `pid` is an additional filter that narrows results; required when
 * multiple processes own windows matching the same title substring.
 */
export interface ResolveRequest {
  hwnd?: number
  title?: string
  pid?: number
}
