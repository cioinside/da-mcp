/**
 * Public `listWindows` entry point — cross-platform dispatch.
 *
 * In `DA_MCP_TEST_MODE=mock` returns the frozen `MOCK_WINDOWS` fixture so
 * downstream tests can assert on it without spawning native binaries. Real
 * backends (per-OS) live in `./list-linux.ts`, `./list-macos.ts`, and
 * `./list-windows.ts` to keep each under the project's 250 LOC ceiling.
 *
 * Routing per OS:
 *   Linux        → wmctrl (requires wmctrl on PATH; see install-system-deps.sh)
 *   macOS / Win  → built-in tooling (osascript / PowerShell)
 *   unknown      → throws UNSUPPORTED_PLATFORM
 */
import { isMockMode } from '../input/routing.js'
import { detectPlatform } from '../platform/detect.js'
import { DaMcpError } from '../errors.js'
import type { WindowInfo } from './types.js'
import { listWindowsLinux } from './list-linux.js'
import { listWindowsMacos } from './list-macos.js'
import { listWindowsWindows } from './list-windows.js'

export const MOCK_WINDOWS: readonly WindowInfo[] = [
  Object.freeze({
    hwnd: 0x100001,
    pid: 4242,
    title: 'Mock Window — Untitled',
    rect: Object.freeze({ x: 100, y: 100, width: 800, height: 600 }),
    isVisible: true,
  }),
]

export function listWindows(): WindowInfo[] {
  if (isMockMode()) return [...MOCK_WINDOWS]
  const info = detectPlatform()
  switch (info.os) {
    case 'linux':
      return listWindowsLinux(info.tools.wmctrl)
    case 'darwin':
      return listWindowsMacos()
    case 'win32':
      return listWindowsWindows()
    default:
      throw new DaMcpError(
        'UNSUPPORTED_PLATFORM',
        `window listing is not supported on os='${info.os}'`,
      )
  }
}