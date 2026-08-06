/**
 * Public surface of the window subsystem.
 *
 * Re-exports the cross-platform primitives so MCP tool wrappers
 * (`src/tools/window-list.ts`, `src/tools/window-focus.ts`) can import
 * from one place — same pattern as `src/screenshot/index.ts`.
 *
 * NOT re-exported: implementation files (`./list.js`, `./focus.js`,
 * `./resolve.js`). Tests may import them directly via the file path.
 */
export { listWindows, MOCK_WINDOWS } from './list.js'
export { focusWindow } from './focus.js'
export { resolveWindow, matchOne } from './resolve.js'
export type { WindowInfo, FocusResult, ResolveRequest } from './types.js'