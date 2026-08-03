/**
 * Deterministic OCR fixture for mock mode.
 *
 * Two OCRLines ("OK" and "123") so downstream tests can assert on a stable
 * shape regardless of which backend would otherwise be in use.
 */
import type { OCRLine, OCRResult } from './types.js'

export function mockResult(): OCRResult {
  const lineA: OCRLine = {
    bbox: { x: 0, y: 0, width: 50, height: 20 },
    words: [
      {
        text: 'OK',
        bbox: { x: 0, y: 0, width: 25, height: 20 },
        confidence: 0.99,
      },
    ],
    confidence: 0.99,
    text: 'OK',
  }
  const lineB: OCRLine = {
    bbox: { x: 60, y: 0, width: 80, height: 20 },
    words: [
      {
        text: '123',
        bbox: { x: 60, y: 0, width: 40, height: 20 },
        confidence: 0.95,
      },
    ],
    confidence: 0.95,
    text: '123',
  }
  return {
    source: 'mock',
    words: [...lineA.words, ...lineB.words],
    lines: [lineA, lineB],
    elements: [],
    durationMs: 0,
    backend: 'cli',
  }
}