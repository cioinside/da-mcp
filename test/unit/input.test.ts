import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import { toRobotjsModifier } from '../../src/input/keyboard.js'

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

// ---- toRobotjsModifier ------------------------------------------------------
// Regression tests for the MCP-modifier → robotjs-flag translation.
// robotjs throws "Invalid key flag specified" for the MCP-side names "ctrl" /
// "meta" because it expects "control" / "command". See PR description.

describe('toRobotjsModifier', () => {
  it('translates "ctrl" → "control"', () => {
    expect(toRobotjsModifier('ctrl')).toBe('control')
  })

  it('translates "meta" → "command"', () => {
    expect(toRobotjsModifier('meta')).toBe('command')
  })

  it('passes "shift" through unchanged', () => {
    expect(toRobotjsModifier('shift')).toBe('shift')
  })

  it('passes "alt" through unchanged', () => {
    expect(toRobotjsModifier('alt')).toBe('alt')
  })

  it('passes unknown names through unchanged (passthrough)', () => {
    // Future MCP-modifier additions should not be silently dropped; the
    // robotjs side will reject them with a clear error if unsupported.
    expect(toRobotjsModifier('hyper')).toBe('hyper')
  })
})