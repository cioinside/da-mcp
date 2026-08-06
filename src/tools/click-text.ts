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
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { DaMcpError } from '../errors.js'
import { mouseClick, mouseMove } from '../input/index.js'
import { runOcr } from '../ocr/index.js'
import { classifyUiElements } from '../ocr/classify.js'
import { screenshot } from '../screenshot/index.js'
import type { UIElement } from '../ocr/types.js'

const INT32_MAX = 2147483647

const schema = z.object({
  text: z.string().min(1),
  fuzzy: z.boolean().optional(),
  displayId: z.number().int().min(0).max(INT32_MAX).nullable().optional(),
})

/** Normalize for fuzzy matching: lowercase, trim, collapse internal whitespace. */
function normalizeForFuzzy(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

function matches(element: UIElement, text: string, fuzzy: boolean): boolean {
  if (!fuzzy) return element.text.includes(text)
  const haystack = normalizeForFuzzy(element.text)
  const needle = normalizeForFuzzy(text)
  return haystack.includes(needle)
}

/**
 * Pick the best match from `elements`: highest confidence, ties broken by
 * earliest index. Caller guarantees `elements.length >= 1`.
 */
function pickBest(elements: readonly UIElement[]): UIElement {
  const first = elements[0]
  if (first === undefined) {
    throw new DaMcpError(
      'INTERNAL',
      'pickBest called with empty elements array',
    )
  }
  let best: UIElement = first
  for (let i = 1; i < elements.length; i++) {
    const el = elements[i]
    if (el === undefined) continue
    if (el.confidence > best.confidence) best = el
  }
  return best
}

export const daClickText = defineTool({
  name: 'da_click_text',
  description:
    'Click the on-screen element whose text label matches `text`. Uses OCR + UI-element classification to locate the text, then clicks the center of its bounding box. Set `fuzzy: true` for case-insensitive matching with whitespace normalization. Returns the clicked coordinates, the matched bbox, and the recognized text. Throws `NOT_FOUND` when no element matches.',
  inputSchema: schema,
  handler: async (input) => {
    const fuzzy = input.fuzzy ?? false
    const displayId = input.displayId ?? null
    const image = await screenshot(displayId)
    const ocr = await runOcr({ image, displayId })
    const elements = classifyUiElements(ocr.lines)
    const matchesList = elements.filter((el) => matches(el, input.text, fuzzy))
    if (matchesList.length === 0) {
      throw new DaMcpError(
        'NOT_FOUND',
        `No element with text matching "${input.text}" (fuzzy=${String(fuzzy)})`,
      )
    }
    const matched = pickBest(matchesList)
    const { bbox } = matched
    const centerX = bbox.x + Math.floor(bbox.width / 2)
    const centerY = bbox.y + Math.floor(bbox.height / 2)
    await mouseMove(centerX, centerY)
    await mouseClick('left')
    return {
      matched: true,
      clicked: { x: centerX, y: centerY },
      bbox: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
      confidence: matched.confidence,
      text: matched.text,
    }
  },
})