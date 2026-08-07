/**
 * da_wait_for_text — poll the OCR text-match pipeline until `text` appears
 * on screen, or `timeoutMs` elapses.
 *
 * Use this after any UI-changing action (click, key, drag, dialog open) to
 * confirm the new state is painted and the expected text is readable. The
 * article on LLM-driven desktop automation called this out as the #1
 * failure mode: agents click "into" dialogs that haven't drawn yet, then
 * fire the next tool before the previous one took effect.
 *
 * Reuses `runTextMatch` from `./ocr-match.ts` so the matching semantics
 * (substring vs. fuzzy, confidence tie-break, `NOT_FOUND` on no match)
 * are identical to `da_click_text` / `da_find_text`.
 *
 * On timeout: throws `DaMcpError('NOT_FOUND')` with elapsed + attempt count.
 *
 * Polling cadence: `intervalMs` (default 200ms, min 50, max 5000). The first
 * check happens immediately, so a text that's already visible is returned
 * without waiting.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { DaMcpError } from '../errors.js'
import { runTextMatch, type RunTextMatchDeps } from './ocr-match.js'

const INT32_MAX = 2147483647
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_INTERVAL_MS = 200
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 5000
const MAX_TIMEOUT_MS = 60000

const schema = z.object({
  text: z.string().min(1),
  fuzzy: z.boolean().optional(),
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
  timeoutMs: z.number().int().min(0).max(MAX_TIMEOUT_MS).optional(),
  intervalMs: z.number().int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS).optional(),
})

export const daWaitForText = defineTool({
  name: 'da_wait_for_text',
  description:
    'Block until `text` appears on screen (OCR + UI-element classification), or `timeoutMs` (default 5000, max 60000) elapses. Match strategy is identical to `da_click_text` / `da_find_text` — substring by default, set `fuzzy: true` for case-insensitive + whitespace-normalized matching. Polls every `intervalMs` (default 200, min 50, max 5000). Throws `NOT_FOUND` on timeout. Use this after a click / key / dialog-open to confirm the new state is painted before continuing.',
  inputSchema: schema,
  handler: async (input, deps?: RunTextMatchDeps) => {
    const fuzzy = input.fuzzy ?? false
    const displayId = input.displayId ?? null
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS

    const started = Date.now()
    let attempts = 0
    let lastError: unknown = null
    while (true) {
      attempts++
      const elapsed = Date.now() - started
      try {
        const result = await runTextMatch(
          { text: input.text, fuzzy, displayId },
          deps,
        )
        const { element, text, center } = result
        return {
          found: true,
          text,
          bbox: {
            x: element.bbox.x,
            y: element.bbox.y,
            width: element.bbox.width,
            height: element.bbox.height,
          },
          center,
          confidence: element.confidence,
          waitedMs: elapsed,
          attempts,
        }
      } catch (err) {
        // NOT_FOUND is the only error we expect from runTextMatch — anything
        // else (OCR_FAILED, NATIVE_MISSING, INVALID_ARGUMENT) is fatal and
        // should propagate immediately. Retry on NOT_FOUND.
        if (!DaMcpError.is(err) || err.code !== 'NOT_FOUND') throw err
        lastError = err
      }
      if (elapsed >= timeoutMs) {
        const detail = lastError instanceof Error ? lastError.message : 'unknown'
        throw new DaMcpError(
          'NOT_FOUND',
          `Text "${input.text}" not found within ${String(elapsed)}ms (${String(attempts)} attempts; last error: ${detail})`,
        )
      }
      await sleep(intervalMs)
    }
  },
})

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}