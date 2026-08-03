/**
 * Rule table for the UI-element classifier.
 *
 * This file is DATA ONLY. No `classify()` function lives here.
 * See src/ocr/classify.ts (T3.1) for the matcher that consumes DEFAULT_RULES.
 *
 * Adding a new rule:
 *   1. Define the predicate carefully — predicates run synchronously per candidate.
 *   2. Add the rule to DEFAULT_RULES at the correct priority order.
 *   3. Add a test case in test/unit/classify-rules.test.ts.
 */

import type { UIElementKind } from './types.js'

/** Heuristic thresholds used by the classifier.
 *  Centralized here so they're tunable + testable in isolation. */
export interface ClassifierConfig {
  /** Minimum confidence (0..1) for a single word to be considered in classification. */
  minWordConfidence: number
  /** Minimum contrast delta (0..1) between foreground and background to call something a "button". */
  minButtonContrast: number
  /** Min aspect ratio (width/height) for something to be classified as button. */
  buttonMinAspect: number
  /** Max aspect ratio for something to be input. */
  inputMaxAspect: number
  /** Min width in pixels for a button candidate. */
  buttonMinWidthPx: number
  /** Min height in pixels for a button candidate. */
  buttonMinHeightPx: number
  /** OCR confidence above which a word becomes a "label" candidate. */
  labelMinConfidence: number
}

/** The default config — exported so other modules can construct child configs. */
export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  minWordConfidence: 0.5,
  minButtonContrast: 0.6,
  buttonMinAspect: 1.5,
  inputMaxAspect: 8.0,
  buttonMinWidthPx: 32,
  buttonMinHeightPx: 16,
  labelMinConfidence: 0.7,
}

/** The candidate fed to each rule's predicate. */
export interface ClassificationCandidate {
  /** The merged bounding box (in image pixels). */
  bbox: { x: number; y: number; width: number; height: number }
  /** Recognized text inside (may be empty for pure-button candidates). */
  text: string
  /** Mean OCR confidence (0..1) of contributing words. */
  confidence: number
  /** Aspect ratio (width / height). */
  aspectRatio: number
  /** Foreground/background contrast delta (0..1). 1 = pure black on white. */
  contrastDelta: number
  /** Pixel density inside the bbox (1.0 = solid). */
  pixelDensity: number
}

/** A single rule: matches if `kind` matches AND the predicate returns true.
 *  Rules are evaluated in declaration order; the first match wins. */
export interface ClassificationRule {
  /** The kind this rule emits if matched. */
  kind: UIElementKind
  /** Human-readable rule name, used for debugging/logs. */
  name: string
  /** Predicate: given the merged candidate bbox + text + confidence, decide if it matches. */
  predicate: (candidate: ClassificationCandidate) => boolean
}

/** Built-in rule set — exported for inspection + reuse by tests.
 *  Order matters; rules are evaluated top-to-bottom. */
export const DEFAULT_RULES: readonly ClassificationRule[] = [
  // 1. Windows (rectangular UI chrome) — short label, very wide.
  {
    kind: 'window-title',
    name: 'short-wide-centered-text',
    predicate: (c) => c.aspectRatio > 4 && c.text.length > 0 && c.text.length < 80 && c.confidence >= 0.5,
  },
  // 2. Buttons (high-contrast rectangles with text inside)
  {
    kind: 'button',
    name: 'high-contrast-rectangle-with-text',
    predicate: (c) =>
      c.contrastDelta >= 0.6 &&
      c.bbox.width >= 32 &&
      c.bbox.height >= 16 &&
      c.aspectRatio >= 1.5 &&
      c.text.length > 0,
  },
  // 3. Checkboxes (small square with text beside)
  {
    kind: 'checkbox',
    name: 'small-square-with-adjacent-text',
    predicate: (c) =>
      Math.abs(c.aspectRatio - 1.0) < 0.3 &&
      c.bbox.width < 24 &&
      c.bbox.height < 24 &&
      c.text.length > 0,
  },
  // 4. Radio (same as checkbox but slightly smaller)
  {
    kind: 'radio',
    name: 'tiny-square-with-adjacent-text',
    predicate: (c) =>
      Math.abs(c.aspectRatio - 1.0) < 0.3 &&
      c.bbox.width < 16 &&
      c.bbox.height < 16,
  },
  // 5. Inputs (wide rectangle, may be empty text)
  {
    kind: 'input',
    name: 'wide-empty-rectangle',
    predicate: (c) =>
      c.aspectRatio >= 4 &&
      c.text.length === 0 &&
      c.contrastDelta >= 0.5,
  },
  // 6. Labels (single line of high-confidence text)
  {
    kind: 'label',
    name: 'single-line-text',
    predicate: (c) =>
      c.aspectRatio >= 2 &&
      c.text.length >= 1 &&
      c.confidence >= 0.7,
  },
  // 7. Dialog actions (text containing common dialog-action keywords).
  {
    kind: 'dialog',
    name: 'dialog-action-keywords',
    predicate: (c) => {
      const t = c.text.toLowerCase()
      if (t.length === 0 || c.confidence < 0.5) return false
      const keywords = ['ok', 'cancel', 'apply', 'close', 'confirm', 'accept', 'reject', 'save']
      return keywords.some((k) => t.includes(k))
    },
  },
  // 8. Menu bar (text equal to a standard top-level menu name).
  {
    kind: 'menu',
    name: 'menu-bar-keywords',
    predicate: (c) => {
      const t = c.text.toLowerCase().trim()
      if (t.length === 0 || c.confidence < 0.5) return false
      const keywords = ['file', 'edit', 'view', 'tools', 'help', 'window', 'format', 'insert']
      return keywords.includes(t)
    },
  },
  // 9. Menu item (text equal to a common dropdown-menu action name).
  {
    kind: 'menu-item',
    name: 'menu-item-action-keywords',
    predicate: (c) => {
      const t = c.text.toLowerCase().trim()
      if (t.length === 0 || c.confidence < 0.5) return false
      const keywords = [
        'new',
        'open',
        'save',
        'save as',
        'exit',
        'quit',
        'copy',
        'paste',
        'cut',
        'undo',
        'redo',
        'find',
      ]
      return keywords.includes(t)
    },
  },
  // 10. Icon (small empty region, or short text containing icon-related keywords).
  {
    kind: 'icon',
    name: 'icon-by-keywords-or-empty-region',
    predicate: (c) => {
      const t = c.text.toLowerCase()
      const keywords = ['icon', 'img', 'image', 'logo', 'symbol', 'avatar', 'glyph', 'thumb']
      const keywordHit = c.text.length > 0 && keywords.some((k) => t.includes(k))
      const emptyRegion =
        c.text.length === 0 &&
        c.bbox.width <= 32 &&
        c.bbox.height <= 32 &&
        Math.abs(c.aspectRatio - 1.0) < 0.5
      return keywordHit || emptyRegion
    },
  },
  // 11. Fallback (catches everything else that has text)
  {
    kind: 'unknown',
    name: 'catch-all',
    predicate: () => true,
  },
]
