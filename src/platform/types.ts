/**
 * Cross-platform abstractions for desktop automation.
 *
 * This module defines SHARED TYPES only — it contains NO business logic.
 * Per-OS dispatch and tool probing live in src/platform/detect.ts.
 */

// Operating system identifier.
export type OsId = 'linux' | 'darwin' | 'win32' | 'unknown'

// Display server identifier (Linux only — other OSes collapse to 'native').
export type DisplayServerId = 'x11' | 'wayland' | 'native' | 'unknown'

// Available system tools (detected once at startup; can be re-detected).
export interface AvailableTools {
  xdotool: boolean          // Linux/X11 keyboard/mouse CLI
  ydotool: boolean          // Linux/Wayland keyboard/mouse CLI (requires daemon)
  wtype: boolean            // Linux/Wayland typing CLI
  wmctrl: boolean           // Linux X11/Wayland window manager CLI (da_window_list/focus)
  screenshotDesktop: boolean // node-screenshots napi binary
  nutjs: boolean             // @nut-tree-fork/nut-js native input library (macOS/Windows)
  tesseract: boolean        // OCR CLI
  scrot: boolean            // X11 screenshot CLI (fallback)
  grim: boolean             // Wayland screenshot CLI
  screencapture: boolean    // macOS screenshot CLI (built-in)
}

// Detected platform + tooling.
export interface PlatformInfo {
  os: OsId
  display: DisplayServerId
  displayEnv: string | null       // raw DISPLAY or WAYLAND_DISPLAY value
  arch: NodeJS.Architecture       // 'arm64' | 'x64' | etc.
  tools: AvailableTools
}

// Bounds (x, y, width, height). All pixel values, screen coords.
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// Display metadata (one per physical or virtual display).
export interface DisplayInfo {
  id: number             // OS-specific display id (X11: XScreenNumber; Wayland: output id; macOS: CGDirectDisplayID; Windows: HMONITOR cast to number)
  name: string           // human-readable (e.g. "DP-1", "Built-in")
  isPrimary: boolean
  bounds: Rect           // position in global desktop coords
  scaleFactor: number    // 1.0, 1.5, 2.0, ...
  rotation: 0 | 90 | 180 | 270
  refreshRateHz?: number // optional; not always detectable
}

// Buttons for da_click / da_double_click.
export type MouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward'

// Modifier keys for da_key / da_type.
export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta' | 'super'

// Single key name (X11 names; we map to platform internally).
// Common examples: 'Return', 'Tab', 'Escape', 'BackSpace', 'space',
// 'Up', 'Down', 'Left', 'Right', 'F1'..'F12', 'a'..'z'.
export type KeyName = string

// Spawn options. shell:false is MANDATORY — defined as a literal 'false' here.
export interface SpawnOpts {
  cwd?: string
  env?: Readonly<Record<string, string>>
  /** Captured stdio streams. If omitted, all streams are 'ignore'. */
  stdio?:
    | 'inherit'
    | 'pipe'
    | 'ignore'
    | readonly [
      NodeJS.WritableStream | 'inherit' | 'pipe' | 'ignore',
      NodeJS.ReadableStream | 'inherit' | 'pipe' | 'ignore',
      NodeJS.ReadableStream | 'inherit' | 'pipe' | 'ignore',
    ]
  /** Detach process from MCP server lifecycle. Default true for launch tools. */
  detached?: boolean
}

export interface SpawnHandle {
  pid: number | null
  killed: boolean
  /** Promise resolving when process exits. */
  exited: Promise<number>          // exit code or signal number
  /** Forcefully kill the process (SIGTERM on Unix, TerminateProcess on Windows). */
  kill(): void
}

// PlatformAdapter — implemented by per-OS modules (W2.x).
// All methods MUST be safe to call concurrently (use internal locking if needed).
export interface PlatformAdapter {
  readonly info: PlatformInfo

  // Screenshot: returns PNG buffer. displayId===null means primary.
  screenshot(displayId: number | null): Promise<Buffer>

  // Display enumeration
  listDisplays(): Promise<DisplayInfo[]>

  // Mouse
  mouseMove(x: number, y: number): Promise<void>
  mouseClick(button: MouseButton, count: number): Promise<void>      // count: 1=click, 2=double-click
  mouseDown(button: MouseButton): Promise<void>
  mouseUp(button: MouseButton): Promise<void>
  mouseScroll(dx: number, dy: number): Promise<void>                  // positive dy = scroll down
  mouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void>

  // Keyboard
  keyTap(key: KeyName, modifiers?: readonly Modifier[]): Promise<void>
  keyDown(key: KeyName): Promise<void>
  keyUp(key: KeyName): Promise<void>
  typeText(text: string, perCharDelayMs?: number): Promise<void>

  // Program launch (returns PID; caller can .kill() it).
  spawnProgram(argv: readonly string[], opts?: SpawnOpts): Promise<SpawnHandle>

  // Cleanup (free native handles, reset state).
  dispose(): Promise<void>
}