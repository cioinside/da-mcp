/**
 * da_ocr — capture a display, run OCR on the buffer, classify UI elements.
 *
 * The handler chains: screenshot -> runOcr -> classifyUiElements. In mock mode
 * every layer is a no-op that returns a deterministic fixture, so the handler
 * is fully exercised by the unit tests without touching native APIs.
 */
import { z } from 'zod'
import { defineTool } from './types.js'
import { screenshot } from '../screenshot/index.js'
import { runOcr } from '../ocr/index.js'
import { classifyUiElements } from '../ocr/classify.js'

const schema = z.object({
  displayId: z.number().int().min(0).max(32767).nullable().optional(),
  lang: z.string().min(1).optional(),
})

export const daOcr = defineTool({
  name: 'da_ocr',
  description:
    'Run OCR (Tesseract) on a display and return recognized text plus classified UI elements.',
  inputSchema: schema,
  handler: async (input) => {
    const displayId = input.displayId ?? null
    const image = await screenshot(displayId)
    const ocr = await runOcr({
      image,
      displayId,
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
    })
    const elements = classifyUiElements(ocr.lines)
    return {
      source: ocr.source,
      backend: ocr.backend,
      durationMs: ocr.durationMs,
      lines: ocr.lines,
      words: ocr.words,
      elements: [...elements],
    }
  },
})
