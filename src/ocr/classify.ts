/**
 * Pure UI-element classifier: turns OCRLine[] into UIElement[].
 *
 * Each line is reduced to a ClassificationCandidate (geometry + content proxy
 * for contrast, since pixel data is unavailable in this layer), then matched
 * against DEFAULT_RULES in declaration order — first match wins. The final
 * DEFAULT_RULES entry is a catch-all (`unknown`) so the no-match branch is
 * only reachable if a custom rule set omits a catch-all; in that case we emit
 * a defensive fallback.
 */

import {
  DEFAULT_RULES,
  type ClassificationCandidate,
} from './classify-rules.js'
import type { OCRLine, UIElement } from './types.js'

/** Approximate contrast from OCR confidence: high-confidence text implies high contrast. */
function contrastFromConfidence(confidence: number): number {
  if (confidence < 0) return 0
  if (confidence > 1) return 1
  return confidence
}

/** Reduce an OCRLine to the predicate input. */
function candidateFromLine(line: OCRLine): ClassificationCandidate {
  const { width, height } = line.bbox
  const aspectRatio = height > 0 ? width / height : 0
  return {
    bbox: line.bbox,
    text: line.text,
    confidence: line.confidence,
    aspectRatio,
    contrastDelta: contrastFromConfidence(line.confidence),
    pixelDensity: 1,
  }
}

/** Walk DEFAULT_RULES in order; first predicate that returns true wins. */
function matchRule(candidate: ClassificationCandidate): UIElement {
  for (const rule of DEFAULT_RULES) {
    if (rule.predicate(candidate)) {
      return elementFromCandidate(candidate, rule.kind, candidate.confidence)
    }
  }
  return elementFromCandidate(candidate, 'unknown', 0.5)
}

function elementFromCandidate(
  candidate: ClassificationCandidate,
  kind: UIElement['kind'],
  confidence: number,
): UIElement {
  const clamped = confidence < 0 ? 0 : confidence > 1 ? 1 : confidence
  return {
    kind,
    text: candidate.text,
    confidence: clamped,
    bbox: candidate.bbox,
    sourceWordIndices: [],
  }
}

/**
 * Classify a list of OCRLines into UIElement[]. Pure: no IO, no platform checks.
 * Order is preserved from the input.
 */
export function classifyUiElements(
  lines: readonly OCRLine[],
): readonly UIElement[] {
  const out: UIElement[] = []
  for (const line of lines) {
    out.push(matchRule(candidateFromLine(line)))
  }
  return out
}