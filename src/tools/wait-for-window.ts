/**
 * da_wait_for_window — poll `da_window_list` until a window with a matching
 * title appears, or `timeoutMs` elapses.
 *
 * Use this after `da_launch` / `da_window_focus` to make sure the target
 * window is actually painted before clicking inside it. Without this, the
 * agent often clicks "into" a window that hasn't redrawn yet — clicks land
 * on stale coordinates, focus races, dialogs miss.
 *
 * Match strategies:
 *   - match: 'substring' (default) — case-insensitive substring on `title`.
 *   - match: 'exact'    — case-insensitive full-string equality on `title`.
 *   - match: 'regex'    — RegExp test on `title` (full match). Caller supplies
 *                          a syntactically valid pattern; invalid patterns
 *                          throw `INVALID_ARGUMENT` synchronously.
 *
 * On timeout: throws `DaMcpError('NOT_FOUND')` with message including the
 * timeout duration and the matched/missing title. Returns the first matching
 * `WindowInfo` on success.
 *
 * Polling cadence: `intervalMs` (default 200ms, min 50, max 5000). The first
 * check happens immediately, so a window that's already present is returned
 * without waiting.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { DaMcpError } from '../errors.js'
import { listWindows } from '../window/index.js'
import type { WindowInfo } from '../window/types.js'

const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_INTERVAL_MS = 200
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 5000
const MAX_TIMEOUT_MS = 60000

const schema = z.object({
  title: z.string().min(1),
  match: z.enum(['substring', 'exact', 'regex']).optional(),
  timeoutMs: z.number().int().min(0).max(MAX_TIMEOUT_MS).optional(),
  intervalMs: z.number().int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS).optional(),
})

export const daWaitForWindow = defineTool({
  name: 'da_wait_for_window',
  description:
    'Block until a window with a matching title appears in `da_window_list`, or `timeoutMs` (default 5000, max 60000) elapses. Match strategies: "substring" (default, case-insensitive), "exact", or "regex" (full match). Polls every `intervalMs` (default 200, min 50, max 5000). Throws `NOT_FOUND` on timeout — use this after `da_launch` to wait for a newly-spawned app to finish painting before clicking inside it.',
  inputSchema: schema,
  handler: async (input) => {
    const match = input.match ?? 'substring'
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS

    const matcher = makeMatcher(input.title, match)
    const started = Date.now()
    let attempts = 0
    while (true) {
      attempts++
      const elapsed = Date.now() - started
      const found = findMatch(listWindows(), matcher)
      if (found !== null) {
        return {
          found: true,
          window: found,
          waitedMs: elapsed,
          attempts,
        }
      }
      if (elapsed >= timeoutMs) {
        throw new DaMcpError(
          'NOT_FOUND',
          `No window matching title="${input.title}" (match=${match}) after ${String(elapsed)}ms (${String(attempts)} attempts)`,
        )
      }
      await sleep(intervalMs)
    }
  },
})

/**
 * Pure matcher factory — bundled into the handler so the loop is small and
 * the matcher is easy to unit-test in isolation.
 */
function makeMatcher(
  title: string,
  match: 'substring' | 'exact' | 'regex',
): (s: string) => boolean {
  switch (match) {
    case 'substring':
      return (s) => s.toLowerCase().includes(title.toLowerCase())
    case 'exact':
      return (s) => s.toLowerCase() === title.toLowerCase()
    case 'regex': {
      const re = new RegExp(title)
      return (s) => re.test(s)
    }
  }
}

function findMatch(
  windows: readonly WindowInfo[],
  matcher: (s: string) => boolean,
): WindowInfo | null {
  for (const w of windows) {
    if (matcher(w.title)) return w
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
