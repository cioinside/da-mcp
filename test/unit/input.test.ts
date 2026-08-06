import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Key } from '@nut-tree-fork/nut-js'
import { initConfig, getConfig, resetConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'
import {
  mouseMove,
  mouseClick,
  mouseDown,
  mouseUp,
  keyTap,
  keyDown,
  keyUp,
  typeText,
  mouseScroll,
  mouseDrag,
} from '../../src/input/index.js'
import { toNutModifier, toNutKey } from '../../src/input/keyboard.js'

const TRACKED = ['DA_MCP_TEST_MODE', 'DA_MCP_MAX_TYPE_BYTES'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = {
    DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'],
    DA_MCP_MAX_TYPE_BYTES: process.env['DA_MCP_MAX_TYPE_BYTES'],
  }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
  expect(getConfig().testMode).toBe('mock')
})

afterEach(() => {
  resetConfig()
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

/** Capture a thrown value for DaMcpError code assertions. */
async function captureThrown(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
    return undefined
  } catch (e) {
    return e
  }
}

function assertCode(caught: unknown, code: string): void {
  expect(DaMcpError.is(caught)).toBe(true)
  if (DaMcpError.is(caught)) {
    expect(caught.code).toBe(code)
  }
}

describe('mouseMove', () => {
  it('resolves for valid coords in mock mode', async () => {
    await expect(mouseMove(100, 200)).resolves.toBeUndefined()
  })

  it('throws OUT_OF_BOUNDS for negative x', async () => {
    const caught = await captureThrown(mouseMove(-1, 0))
    assertCode(caught, 'OUT_OF_BOUNDS')
  })

  it('throws OUT_OF_BOUNDS for non-integer y', async () => {
    const caught = await captureThrown(mouseMove(10, 1.5))
    assertCode(caught, 'OUT_OF_BOUNDS')
  })

  it('throws OUT_OF_BOUNDS for y > 32767', async () => {
    const caught = await captureThrown(mouseMove(10, 32_768))
    assertCode(caught, 'OUT_OF_BOUNDS')
  })
})

describe('mouseClick / mouseDown / mouseUp', () => {
  it('mouseClick("left", 2) resolves (double-click in mock mode)', async () => {
    await expect(mouseClick('left', 2)).resolves.toBeUndefined()
  })

  it('mouseClick("right") defaults count to 1', async () => {
    await expect(mouseClick('right')).resolves.toBeUndefined()
  })

  it('mouseClick throws for non-positive count', async () => {
    const caught = await captureThrown(mouseClick('left', 0))
    assertCode(caught, 'INVALID_ARGUMENT')
  })

  it('mouseDown / mouseUp resolve (mock mode)', async () => {
    await expect(mouseDown('left')).resolves.toBeUndefined()
    await expect(mouseUp('left')).resolves.toBeUndefined()
  })
})

describe('keyTap / keyDown / keyUp', () => {
  it('keyTap("Return") resolves (mock mode)', async () => {
    await expect(keyTap('Return')).resolves.toBeUndefined()
  })

  it('keyTap with modifiers resolves (mock mode)', async () => {
    await expect(keyTap('c', ['ctrl'])).resolves.toBeUndefined()
  })

  it('keyDown / keyUp resolve (mock mode)', async () => {
    await expect(keyDown('a')).resolves.toBeUndefined()
    await expect(keyUp('a')).resolves.toBeUndefined()
  })
})

describe('typeText', () => {
  it('typeText("hello") resolves (mock mode)', async () => {
    await expect(typeText('hello')).resolves.toBeUndefined()
  })

  it('typeText with NUL byte throws SHELL_INJECTION_DETECTED', async () => {
    const caught = await captureThrown(typeText('hello\0world'))
    assertCode(caught, 'SHELL_INJECTION_DETECTED')
  })

  it('typeText with text > maxTypeBytes throws INPUT_TOO_LARGE', async () => {
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'mock', DA_MCP_MAX_TYPE_BYTES: '32' })
    // 32 / 4 = 8 chars max; 9 chars triggers the check.
    const tooLong = 'x'.repeat(9)
    const caught = await captureThrown(typeText(tooLong))
    assertCode(caught, 'INPUT_TOO_LARGE')
  })

  it('typeText with text.length * 4 === maxTypeBytes resolves (boundary)', async () => {
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'mock', DA_MCP_MAX_TYPE_BYTES: '40' })
    // 40 / 4 = 10 chars max; 10 chars exactly should pass.
    const exactly = 'x'.repeat(10)
    await expect(typeText(exactly)).resolves.toBeUndefined()
  })
})

describe('mouseScroll', () => {
  it('mouseScroll(0, 100) resolves (mock mode)', async () => {
    await expect(mouseScroll(0, 100)).resolves.toBeUndefined()
  })

  it('mouseScroll rejects non-integer dx', async () => {
    const caught = await captureThrown(mouseScroll(1.5, 0))
    assertCode(caught, 'INVALID_ARGUMENT')
  })

  it('mouseScroll(0, 0) is a no-op and resolves', async () => {
    await expect(mouseScroll(0, 0)).resolves.toBeUndefined()
  })
})

describe('mouseDrag', () => {
  it('mouseDrag(0, 0, 100, 100) resolves (mock mode)', async () => {
    await expect(mouseDrag(0, 0, 100, 100)).resolves.toBeUndefined()
  })

  it('mouseDrag throws OUT_OF_BOUNDS when target is out of range', async () => {
    const caught = await captureThrown(mouseDrag(0, 0, -1, 0))
    assertCode(caught, 'OUT_OF_BOUNDS')
  })
})

// ---- toNutModifier ------------------------------------------------------------
// Regression tests for the MCP-modifier → nut.js Key enum translation.
// Pick Left* variants so chord presses don't desync the modifier state.

describe('toNutModifier', () => {
  it('translates "ctrl" → Key.LeftControl', () => {
    expect(toNutModifier('ctrl')).toBe(Key.LeftControl)
  })

  it('translates "alt" → Key.LeftAlt', () => {
    expect(toNutModifier('alt')).toBe(Key.LeftAlt)
  })

  it('translates "shift" → Key.LeftShift', () => {
    expect(toNutModifier('shift')).toBe(Key.LeftShift)
  })

  it('translates "meta" → Key.LeftMeta', () => {
    expect(toNutModifier('meta')).toBe(Key.LeftMeta)
  })

  it('translates "super" → Key.LeftSuper', () => {
    expect(toNutModifier('super')).toBe(Key.LeftSuper)
  })

  it('throws DaMcpError INVALID_ARGUMENT for unknown modifier names', () => {
    expect(() => toNutModifier('hyper')).toThrow(DaMcpError)
    try {
      toNutModifier('hyper')
    } catch (err) {
      expect(DaMcpError.is(err)).toBe(true)
      if (DaMcpError.is(err)) {
        expect(err.code).toBe('INVALID_ARGUMENT')
      }
    }
  })
})

// ---- toNutKey -----------------------------------------------------------------

describe('toNutKey', () => {
  it('uppercases single-character keys (a → Key.A)', () => {
    expect(toNutKey('a')).toBe(Key.A)
  })

  it('uppercases single-character keys (z → Key.Z)', () => {
    expect(toNutKey('z')).toBe(Key.Z)
  })

  it('uppercases single-character keys (already-uppercase A stays Key.A)', () => {
    expect(toNutKey('A')).toBe(Key.A)
  })

  it('prefixes single digits with "Num" (0 → Key.Num0)', () => {
    expect(toNutKey('0')).toBe(Key.Num0)
  })

  it('prefixes single digits with "Num" (9 → Key.Num9)', () => {
    expect(toNutKey('9')).toBe(Key.Num9)
  })

  it('normalises "BackSpace" → "Backspace"', () => {
    expect(toNutKey('BackSpace')).toBe(Key.Backspace)
  })

  it('normalises "Num_Lock" → "NumLock"', () => {
    expect(toNutKey('Num_Lock')).toBe(Key.NumLock)
  })

  it('normalises "Page_Up" → "PageUp"', () => {
    expect(toNutKey('Page_Up')).toBe(Key.PageUp)
  })

  it('normalises "Page_Down" → "PageDown"', () => {
    expect(toNutKey('Page_Down')).toBe(Key.PageDown)
  })

  it('looks up "Return" in the Key enum', () => {
    expect(toNutKey('Return')).toBe(Key.Return)
  })

  it('looks up "Enter" in the Key enum', () => {
    expect(toNutKey('Enter')).toBe(Key.Enter)
  })

  it('looks up "F5" in the Key enum', () => {
    expect(toNutKey('F5')).toBe(Key.F5)
  })

  it('looks up "Tab" in the Key enum', () => {
    expect(toNutKey('Tab')).toBe(Key.Tab)
  })

  it('throws DaMcpError INVALID_ARGUMENT for unknown key names', () => {
    expect(() => toNutKey('not_a_real_key')).toThrow(DaMcpError)
    try {
      toNutKey('not_a_real_key')
    } catch (err) {
      expect(DaMcpError.is(err)).toBe(true)
      if (DaMcpError.is(err)) {
        expect(err.code).toBe('INVALID_ARGUMENT')
      }
    }
  })

  it('throws DaMcpError INVALID_ARGUMENT for empty string', () => {
    // Empty string is single-char (length === 1) but uppercases to itself;
    // Key[''] is undefined so the lookup fails. Be explicit about the
    // contract rather than treating it as a silent passthrough.
    expect(() => toNutKey('')).toThrow(DaMcpError)
  })
})