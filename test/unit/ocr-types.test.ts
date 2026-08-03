import { describe, it, expectTypeOf } from 'vitest'
import type {
  BoundingBox,
  OCRWord,
  OCRLine,
  OCRResult,
  UIElement,
  UIElementKind,
} from '../../src/ocr/types.js'

describe('ocr/types', () => {
  it('UIElementKind is the expected literal union', () => {
    expectTypeOf<UIElementKind>().toEqualTypeOf<
      'button' | 'input' | 'label' | 'checkbox' | 'radio' | 'menu' | 'menu-item' | 'dialog' | 'window-title' | 'icon' | 'unknown'
    >()
  })

  it('OCRResult has all required top-level keys', () => {
    expectTypeOf<OCRResult>().toHaveProperty('source')
    expectTypeOf<OCRResult>().toHaveProperty('words')
    expectTypeOf<OCRResult>().toHaveProperty('lines')
    expectTypeOf<OCRResult>().toHaveProperty('elements')
    expectTypeOf<OCRResult>().toHaveProperty('durationMs')
    expectTypeOf<OCRResult>().toHaveProperty('backend')
  })

  it('BoundingBox has exactly 4 numeric fields', () => {
    expectTypeOf<BoundingBox['x']>().toEqualTypeOf<number>()
    expectTypeOf<BoundingBox['y']>().toEqualTypeOf<number>()
    expectTypeOf<BoundingBox['width']>().toEqualTypeOf<number>()
    expectTypeOf<BoundingBox['height']>().toEqualTypeOf<number>()
  })

  it('OCRWord has confidence as number and bbox as BoundingBox', () => {
    expectTypeOf<OCRWord['confidence']>().toEqualTypeOf<number>()
    expectTypeOf<OCRWord['bbox']>().toEqualTypeOf<BoundingBox>()
  })

  it('OCRLine carries words: OCRWord[]', () => {
    expectTypeOf<OCRLine['words']>().toEqualTypeOf<OCRWord[]>()
  })

  it('UIElement.sourceWordIndices is number[]', () => {
    expectTypeOf<UIElement['sourceWordIndices']>().toEqualTypeOf<number[]>()
  })
})
