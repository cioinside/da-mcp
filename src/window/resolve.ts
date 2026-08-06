/**
 * Cross-platform window resolver: turn a `ResolveRequest` into a concrete
 * `WindowInfo`, or null when nothing matches.
 *
 * Match rules:
 *   - `hwnd` provided → exact match on the integer hwnd
 *   - `title` provided → case-insensitive substring match against window title
 *   - `pid` provided → additional filter that narrows by owning process id
 *   - Either `hwnd` or `title` is REQUIRED (caller must specify one); `pid`
 *     alone is not enough because multiple processes can share a pid namespace
 *     on some hosts (PID reuse on Windows in particular).
 *
 * In mock mode (DA_MCP_TEST_MODE=mock) matches against MOCK_WINDOWS so
 * downstream tests can exercise the resolver without native binaries.
 */
import { listWindows, MOCK_WINDOWS } from './list.js'
import { DaMcpError } from '../errors.js'
import type { ResolveRequest, WindowInfo } from './types.js'

export function resolveWindow(req: ResolveRequest): WindowInfo | null {
  if (req.hwnd === undefined && req.title === undefined) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'resolveWindow requires either hwnd or title (pid alone is not enough to disambiguate)',
    )
  }
  if (req.hwnd !== undefined && (!Number.isInteger(req.hwnd) || req.hwnd <= 0)) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `hwnd must be a positive integer; got ${String(req.hwnd)}`,
    )
  }
  if (req.title !== undefined && req.title.length === 0) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'title must be a non-empty string when provided',
    )
  }
  if (req.pid !== undefined && (!Number.isInteger(req.pid) || req.pid < 0)) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `pid must be a non-negative integer; got ${String(req.pid)}`,
    )
  }

  const all = process.env['DA_MCP_TEST_MODE'] === 'mock' ? [...MOCK_WINDOWS] : listWindows()
  return matchOne(all, req)
}

/**
 * Pure helper exposed for unit testing: filter `all` by `req` and return the
 * first match (or null). Splits out the matching logic from the I/O + error
 * paths in `resolveWindow` so tests can drive it without mocks.
 */
export function matchOne(
  all: readonly WindowInfo[],
  req: ResolveRequest,
): WindowInfo | null {
  // hwnd exact match — wins over title if both are supplied (caller intent)
  if (req.hwnd !== undefined) {
    const hit = all.find((w) => w.hwnd === req.hwnd)
    if (hit === undefined) return null
    if (req.pid !== undefined && hit.pid !== req.pid) return null
    return hit
  }
  // title substring match (case-insensitive). pid is an additional filter.
  const needle = (req.title ?? '').toLowerCase()
  for (const w of all) {
    if (!w.title.toLowerCase().includes(needle)) continue
    if (req.pid !== undefined && w.pid !== req.pid) continue
    return w
  }
  return null
}