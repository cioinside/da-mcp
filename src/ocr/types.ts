/**
 * Pure data types for OCR + UI-element classification.
 *
 * The shape of OCRWord matches Tesseract's tsv output (level=5) so this module can
 * map directly from the raw CLI output. BoundingBox values are in image-pixel coords,
 * with (0,0) at top-left — consistent with node-screenshots' captureImage().
 */

/** Pixel-space axis-aligned bounding box. */
export interface BoundingBox {
  /** left edge, in image pixels */
  x: number
  /** top edge, in image pixels */
  y: number
  /** width in image pixels */
  width: number
  /** height in image pixels */
  height: number
}

/** A single word/line detected by OCR, in image coords. */
export interface OCRWord {
  /** recognized text */
  text: string
  /** confidence 0..1 (Tesseract returns 0..100; we normalize) */
  confidence: number
  /** bounding box */
  bbox: BoundingBox
  /** block id from Tesseract */
  blockId?: number
  /** paragraph id within block */
  paragraphId?: number
  /** line id within paragraph */
  lineId?: number
  /** word id within line */
  wordId?: number
}

/** A line of words grouped together. */
export interface OCRLine {
  text: string
  words: OCRWord[]
  bbox: BoundingBox
  confidence: number
}

/** Kinds of UI elements we classify. */
export type UIElementKind =
  | 'button'
  | 'input'
  | 'label'
  | 'checkbox'
  | 'radio'
  | 'menu'
  | 'menu-item'
  | 'dialog'
  | 'window-title'
  | 'icon'
  | 'unknown'

/** Classified UI element result. */
export interface UIElement {
  kind: UIElementKind
  /** human-readable text associated with the element (e.g. button label) */
  text: string
  /** confidence 0..1 */
  confidence: number
  bbox: BoundingBox
  /** which OCRWord(s) contributed (indices into OCRResult.words) */
  sourceWordIndices: number[]
}

/** Top-level OCR result. */
export interface OCRResult {
  /** filename or path the OCR was run on, for logs */
  source: string
  /** all words in reading order */
  words: OCRWord[]
  /** grouped lines */
  lines: OCRLine[]
  /** classified UI elements (may be empty if no classify() run) */
  elements: UIElement[]
  /** total processing time in ms (for logging) */
  durationMs: number
  /** which backend produced the result */
  backend: 'cli' | 'wasm'
}
