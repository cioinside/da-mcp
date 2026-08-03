import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CLASSIFIER_CONFIG,
  DEFAULT_RULES,
  type ClassificationCandidate,
  type ClassificationRule,
} from '../../src/ocr/classify-rules.js'

/** Helper: find a rule by its `name`. Throws if not present so test failures are loud. */
function ruleByName(name: string): ClassificationRule {
  const rule = DEFAULT_RULES.find((r) => r.name === name)
  if (!rule) throw new Error(`rule not found: ${name}`)
  return rule
}

describe('DEFAULT_CLASSIFIER_CONFIG', () => {
  it('exposes every threshold', () => {
    const requiredKeys = [
      'minWordConfidence',
      'minButtonContrast',
      'buttonMinAspect',
      'inputMaxAspect',
      'buttonMinWidthPx',
      'buttonMinHeightPx',
      'labelMinConfidence',
    ] as const
    for (const key of requiredKeys) {
      expect(
        key in DEFAULT_CLASSIFIER_CONFIG,
        `missing config key: ${key}`,
      ).toBe(true)
    }
  })

  it('values are positive and sane', () => {
    const c = DEFAULT_CLASSIFIER_CONFIG
    expect(c.minWordConfidence).toBeGreaterThanOrEqual(0)
    expect(c.minWordConfidence).toBeLessThanOrEqual(1)
    expect(c.minButtonContrast).toBeGreaterThan(0)
    expect(c.minButtonContrast).toBeLessThanOrEqual(1)
    expect(c.buttonMinAspect).toBeGreaterThan(1)
    expect(c.inputMaxAspect).toBeGreaterThan(c.buttonMinAspect)
    expect(c.buttonMinWidthPx).toBeGreaterThan(0)
    expect(c.buttonMinHeightPx).toBeGreaterThan(0)
    expect(c.labelMinConfidence).toBeGreaterThan(0)
    expect(c.labelMinConfidence).toBeLessThanOrEqual(1)
  })
})
describe('DEFAULT_RULES', () => {
  it('is non-empty', () => {
    expect(DEFAULT_RULES.length).toBeGreaterThanOrEqual(5)
  })

  it('contains exactly one catch-all (kind=unknown)', () => {
    const catchAlls = DEFAULT_RULES.filter((r) => r.kind === 'unknown')
    expect(catchAlls.length).toBe(1)
  })

  it('catch-all is the LAST rule', () => {
    const last = DEFAULT_RULES[DEFAULT_RULES.length - 1]
    expect(last?.kind).toBe('unknown')
  })

  it('rules have unique names', () => {
    const names = DEFAULT_RULES.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('rule predicates', () => {
  it('window-title fires on short-wide text', () => {
    const rule = ruleByName('short-wide-centered-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 500, height: 100 },
      text: 'Settings',
      confidence: 0.8,
      aspectRatio: 5,
      contrastDelta: 0,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(true)
  })

  it('window-title rejects very long text', () => {
    const rule = ruleByName('short-wide-centered-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 500, height: 100 },
      text: 'a'.repeat(200),
      confidence: 0.8,
      aspectRatio: 5,
      contrastDelta: 0,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(false)
  })

  it('button fires on high-contrast rectangle with text', () => {
    const rule = ruleByName('high-contrast-rectangle-with-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 64, height: 32 },
      text: 'OK',
      confidence: 0.8,
      aspectRatio: 2,
      contrastDelta: 0.8,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(true)
  })

  it('button rejects low contrast', () => {
    const rule = ruleByName('high-contrast-rectangle-with-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 64, height: 32 },
      text: 'OK',
      confidence: 0.8,
      aspectRatio: 2,
      contrastDelta: 0.3,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(false)
  })

  it('button rejects tiny size', () => {
    const rule = ruleByName('high-contrast-rectangle-with-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 10, height: 5 },
      text: 'OK',
      confidence: 0.8,
      aspectRatio: 2,
      contrastDelta: 0.8,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(false)
  })

  it('input fires on wide empty rectangle with contrast', () => {
    const rule = ruleByName('wide-empty-rectangle')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 320, height: 40 },
      text: '',
      confidence: 0.8,
      aspectRatio: 8,
      contrastDelta: 0.7,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(true)
  })

  it('input rejects non-empty text', () => {
    const rule = ruleByName('wide-empty-rectangle')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 320, height: 40 },
      text: 'hello',
      confidence: 0.8,
      aspectRatio: 8,
      contrastDelta: 0.7,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(false)
  })

  it('label fires on long high-confidence text', () => {
    const rule = ruleByName('single-line-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 90, height: 30 },
      text: 'Name:',
      confidence: 0.9,
      aspectRatio: 3,
      contrastDelta: 0,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(true)
  })

  it('label rejects low confidence', () => {
    const rule = ruleByName('single-line-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 90, height: 30 },
      text: 'Name:',
      confidence: 0.5,
      aspectRatio: 3,
      contrastDelta: 0,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(false)
  })

  it('checkbox fires on small square with adjacent text', () => {
    const rule = ruleByName('small-square-with-adjacent-text')
    const candidate: ClassificationCandidate = {
      bbox: { x: 0, y: 0, width: 20, height: 20 },
      text: '✓',
      confidence: 0.8,
      aspectRatio: 1,
      contrastDelta: 0,
      pixelDensity: 1,
    }
    expect(rule.predicate(candidate)).toBe(true)
  })
})
