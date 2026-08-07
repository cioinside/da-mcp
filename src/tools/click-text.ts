/**
 * da_click_text — click the on-screen element whose OCR-recognized text
 * label matches `text`.
 *
 * Pipeline: screenshot → runOcr → classifyUiElements → text match → mouseMove →
 * mouseClick('left'). Match strategy:
 *   - fuzzy: false → case-sensitive substring (`element.text.includes(text)`).
 *   - fuzzy: true  → lowercase + trim + collapse-whitespace both sides, then
 *                    substring match (still anchored on the OCR-recognized text).
 *
 * Multi-match disambiguation: highest `confidence` wins; ties break to the
 * element that appeared first in the OCR line order (deterministic).
 *
 * No match → DaMcpError('NOT_FOUND'). The element's bbox is in image-pixel
 * space; center is `{ x + floor(width/2), y + floor(height/2) }`.
 *
 * Implementation delegates to the shared `runTextMatch` helper in
 * `./ocr-match.ts`; keep click-specific concerns (mouseMove + mouseClick +
 * the "clicked" envelope) here, leave matching/selection logic in the helper.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { mouseClick, mouseMove } from '../input/index.js'
import { runTextMatch } from './ocr-match.js'

const INT32_MAX = 2147483647

const schema = z.object({
  text: z.string().min(1),
  fuzzy: z.boolean().optional(),
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
})

export const daClickText = defineTool({
  name: 'da_click_text',
  description:
    'Click the on-screen element whose text label matches `text`. Uses OCR + UI-element classification to locate the text, then clicks the center of its bounding box. Set `fuzzy: true` for case-insensitive matching with whitespace normalization. Returns the clicked coordinates, the matched bbox, and the recognized text. Throws `NOT_FOUND` when no element matches.',
  inputSchema: schema,
  handler: async (input) => {
    const fuzzy = input.fuzzy ?? false
    const displayId = input.displayId ?? null
    const { element, text, center } = await runTextMatch({
      text: input.text,
      fuzzy,
      displayId,
    })
    await mouseMove(center.x, center.y)
    await mouseClick('left')
    const { bbox } = element
    return {
      matched: true,
      clicked: center,
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      confidence: element.confidence,
      text,
    }
  },
})