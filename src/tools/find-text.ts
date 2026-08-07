/**
 * da_find_text — locate (do NOT click) the on-screen element whose
 * OCR-recognized text label matches `text`.
 *
 * Same matching pipeline as `da_click_text` (screenshot → OCR → classify →
 * substring/fuzzy filter) but stops before the mouse-move + click. Useful
 * for agents that want to *plan* an action without committing to it — e.g.
 * "show me where 'OK' is so I can decide whether to click it, drag from it,
 * or right-click instead."
 *
 * The bbox is in image-pixel coords, consistent with all other da_* tools.
 * Throws `DaMcpError('NOT_FOUND')` when no element matches.
 *
 * Implementation delegates to the shared `runTextMatch` helper in
 * `./ocr-match.ts`; only the output envelope differs from click-text.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { runTextMatch } from './ocr-match.js'

const INT32_MAX = 2147483647

const schema = z.object({
  text: z.string().min(1),
  fuzzy: z.boolean().optional(),
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
})

export const daFindText = defineTool({
  name: 'da_find_text',
  description:
    'Locate the on-screen element whose text label matches `text` (OCR + UI-element classification). Returns the bounding box, the center coordinates, the recognized text, and the OCR confidence — but does NOT click. Set `fuzzy: true` for case-insensitive matching with whitespace normalization. Throws `NOT_FOUND` when no element matches. Use this when you need to *decide* an action (click vs. drag vs. type-into) based on element position; use `da_click_text` when you already know the action is "click the center".',
  inputSchema: schema,
  handler: async (input) => {
    const fuzzy = input.fuzzy ?? false
    const displayId = input.displayId ?? null
    const { element, text, center } = await runTextMatch({
      text: input.text,
      fuzzy,
      displayId,
    })
    const { bbox } = element
    return {
      matched: true,
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      center,
      confidence: element.confidence,
      text,
    }
  },
})
