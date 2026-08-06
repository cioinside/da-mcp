import { describe, it, expectTypeOf } from 'vitest'
import type {
  MouseButton,
  Modifier,
  KeyName,
  PlatformInfo,
  DisplayInfo,
  Rect,
} from '../../src/platform/types.js'

describe('platform/types', () => {
  it('MouseButton is the expected literal union', () => {
    expectTypeOf<MouseButton>().toEqualTypeOf<
      'left' | 'right' | 'middle' | 'back' | 'forward'
    >()
  })

  it('Modifier includes the standard modifier keys', () => {
    expectTypeOf<Modifier>().toEqualTypeOf<
      'ctrl' | 'alt' | 'shift' | 'meta' | 'super'
    >()
  })

  it('KeyName is assignable from a plain string', () => {
    expectTypeOf<string>().toMatchTypeOf<KeyName>()
  })

  it('PlatformInfo.tools is a Record of booleans', () => {
    expectTypeOf<PlatformInfo['tools']>().toMatchObjectType<{
      xdotool: boolean
      ydotool: boolean
      wtype: boolean
      wmctrl: boolean
      screenshotDesktop: boolean
      tesseract: boolean
      scrot: boolean
      grim: boolean
      screencapture: boolean
    }>()
  })

  it('DisplayInfo has required bounds Rect', () => {
    expectTypeOf<DisplayInfo['bounds']>().toEqualTypeOf<Rect>()
  })
})