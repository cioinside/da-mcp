/**
 * Shared OCR-then-text-match pipeline used by da_click_text, da_find_text,
 * and da_wait_for_text. Three responsibilities live here so the per-tool
 * handlers stay tiny:
 *
 *   1. `runTextMatch` — screenshot → OCR → classify → substring/fuzzy filter.
 *      Pure (no side effects beyond calling the OCR backend); throws
 *      `DaMcpError('NOT_FOUND')` when nothing matches.
 *
 *   2. `normalizeForFuzzy` — lowercase, trim, collapse whitespace. Both
 *      needle and haystack pass through the same normalization before
 *      substring match.
 *
 *   3. `pickBest` — chooses the highest-confidence match; ties broken by
 *      earliest index (deterministic across runs).
 *
 * Sits in `src/tools/` because only tool handlers use it; nothing in
 * `src/ocr/` should import from this file (would invert the layer cake).
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import { classifyUiElements } from '../ocr/classify.js'
import { runOcr } from '../ocr/index.js'
import type { OCRLine, OCRResult, UIElement } from '../ocr/types.js'
import { screenshot } from '../screenshot/index.js'

export interface TextMatchResult {
  /** The chosen element (highest confidence, earliest on ties). */
  readonly element: UIElement
  /** OCR text exactly as returned for the matched element. */
  readonly text: string
  /** Center of the element's bbox in image-pixel coords. */
  readonly center: { readonly x: number; readonly y: number }
}

export interface RunTextMatchOptions {
  readonly text: string
  readonly fuzzy: boolean
  readonly displayId: number | null
}

export interface RunTextMatchDeps {
  readonly screenshotFn?: (displayId: number | null) => Promise<Buffer>
  readonly runOcrFn?: (opts: {
    image: Buffer
    displayId: number | null
  }) => Promise<OCRResult>
  readonly classifyFn?: (lines: readonly OCRLine[]) => readonly UIElement[]
}

/** Normalize for fuzzy matching: lowercase, trim, collapse internal whitespace. */
export function normalizeForFuzzy(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ')
}

export function matchesText(element: UIElement, text: string, fuzzy: boolean): boolean {
  if (!fuzzy) return element.text.includes(text)
  return normalizeForFuzzy(element.text).includes(normalizeForFuzzy(text))
}

/**
 * Pick the best match from `elements`: highest confidence, ties broken by
 * earliest index. Caller guarantees `elements.length >= 1`.
 */
export function pickBest(elements: readonly UIElement[]): UIElement {
  const first = elements[0]
  if (first === undefined) {
    throw new DaMcpError('INTERNAL', 'pickBest called with empty elements array')
  }
  let best: UIElement = first
  for (let i = 1; i < elements.length; i++) {
    const el = elements[i]
    if (el === undefined) continue
    if (el.confidence > best.confidence) best = el
  }
  return best
}

/**
 * Full pipeline: screenshot → OCR → classify → match `text`. Returns the
 * best match (highest confidence, earliest on ties) or throws `NOT_FOUND`.
 *
 * `screenshotFn` / `runOcrFn` / `classifyFn` are injectable so tests can
 * substitute deterministic fixtures without monkey-patching modules.
 */
export async function runTextMatch(
  opts: RunTextMatchOptions,
  deps: RunTextMatchDeps = {},
): Promise<TextMatchResult> {
  const screenshotFn = deps.screenshotFn ?? screenshot
  const runOcrFn =
    deps.runOcrFn ?? ((o) => runOcr({ image: o.image, displayId: o.displayId }))
  const classifyFn = deps.classifyFn ?? classifyUiElements

  const image = await screenshotFn(opts.displayId)
  const ocr = await runOcrFn({ image, displayId: opts.displayId })
  const elements = classifyFn(ocr.lines)
  const matches = elements.filter((el) => matchesText(el, opts.text, opts.fuzzy))
  if (matches.length === 0) {
    throw new DaMcpError(
      'NOT_FOUND',
      `No element with text matching "${opts.text}" (fuzzy=${String(opts.fuzzy)})`,
    )
  }
  const element = pickBest(matches)
  const centerX = element.bbox.x + Math.floor(element.bbox.width / 2)
  const centerY = element.bbox.y + Math.floor(element.bbox.height / 2)
  return {
    element,
    text: element.text,
    center: { x: centerX, y: centerY },
  }
}
