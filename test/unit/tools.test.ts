/**
 * Unit tests for src/tools/.
 *
 * Strategy: in mock mode every handler resolves without touching native APIs,
 * so we can validate (a) every tool definition is shaped correctly,
 * (b) schemas accept valid inputs, and (c) handlers actually run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { initConfig, resetConfig } from '../../src/config.js'
import {
  ALL_TOOLS,
  daScreenshot,
  daOcr,
  daListDisplays,
  daGetMousePosition,
  daMoveMouse,
  daClick,
  daDoubleClick,
  daDrag,
  daScroll,
  daType,
  daKey,
  daLaunch,
} from '../../src/tools/index.js'

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = {
    DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'],
  }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})

afterEach(() => {
  resetConfig()
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

const SCHEDULE: ReadonlyArray<{
  name: string
  tool: { readonly name: string; readonly description: string; readonly inputSchema: unknown; readonly handler: unknown }
  valid: unknown
}> = [
  { name: 'da_screenshot', tool: daScreenshot, valid: { displayId: null } },
  { name: 'da_ocr', tool: daOcr, valid: { displayId: 0, lang: 'eng' } },
  { name: 'da_list_displays', tool: daListDisplays, valid: {} },
  { name: 'da_get_mouse_position', tool: daGetMousePosition, valid: {} },
  { name: 'da_move_mouse', tool: daMoveMouse, valid: { x: 100, y: 200 } },
  { name: 'da_click', tool: daClick, valid: { x: 10, y: 20, button: 'left', count: 1 } },
  { name: 'da_double_click', tool: daDoubleClick, valid: { x: 10, y: 20 } },
  { name: 'da_drag', tool: daDrag, valid: { x1: 0, y1: 0, x2: 50, y2: 50 } },
  { name: 'da_scroll', tool: daScroll, valid: { dx: 0, dy: 100 } },
  { name: 'da_type', tool: daType, valid: { text: 'hello' } },
  { name: 'da_key', tool: daKey, valid: { key: 'Return' } },
  { name: 'da_launch', tool: daLaunch, valid: { argv: ['echo', 'hi'] } },
]

describe('tool definitions', () => {
  // Tests 1-12: one per tool in SCHEDULE.
  for (const { name, tool, valid } of SCHEDULE) {
    it(`${name}: name/description/schema/handler are well-formed and parse the canonical input`, () => {
      expect(tool.name.startsWith('da_')).toBe(true)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(typeof tool.handler).toBe('function')
      const schema = tool.inputSchema as { parse: (v: unknown) => unknown }
      expect(() => schema.parse(valid)).not.toThrow()
    })
  }
})

describe('da_move_mouse handler', () => {
  // Test 13: handler resolves in mock mode.
  it('handler with { x:100, y:200 } resolves in mock mode (skips native)', async () => {
    await expect(daMoveMouse.handler({ x: 100, y: 200 })).resolves.toEqual({
      moved: true,
      x: 100,
      y: 200,
    })
  })

  // Test 14: schema rejects negative x.
  it('inputSchema rejects { x: -1, y: 0 } as OUT_OF_BOUNDS-class validation failure', () => {
    const result = daMoveMouse.inputSchema.safeParse({ x: -1, y: 0 })
    expect(result.success).toBe(false)
  })
})

describe('da_type handler', () => {
  // Test 15: empty string is accepted as a no-op.
  it('inputSchema accepts { text: "" } (typeText treats empty as a no-op)', () => {
    const result = daType.inputSchema.safeParse({ text: '' })
    expect(result.success).toBe(true)
  })
})

describe('da_launch handler', () => {
  // Test 16: argv must have at least one element.
  it('inputSchema rejects { argv: [] } (empty argv)', () => {
    const result = daLaunch.inputSchema.safeParse({ argv: [] })
    expect(result.success).toBe(false)
  })
})

describe('ALL_TOOLS registry', () => {
  // Test 17: registry has exactly 20 tools.
  it('ALL_TOOLS has exactly 20 entries', () => {
    expect(ALL_TOOLS).toHaveLength(20)
  })

  // Test 18: all tool names are unique.
  it('ALL_TOOLS entry names are unique', () => {
    const seen = new Set<string>()
    for (const t of ALL_TOOLS) {
      expect(seen.has(t.name)).toBe(false)
      seen.add(t.name)
    }
    expect(seen.size).toBe(ALL_TOOLS.length)
  })

  // Bonus: da_ocr handler in mock mode captures display, runs OCR, classifies elements.
  it('da_ocr handler in mock mode resolves with OCRResult + classified elements', async () => {
    const result = await daOcr.handler({ displayId: null, lang: 'eng' })
    expect(result).toBeDefined()
    const r = result as { source: string; lines: unknown; words: unknown; elements: ReadonlyArray<{ kind: string }> }
    expect(r.source).toBe('mock')
    expect(Array.isArray(r.lines)).toBe(true)
    expect(Array.isArray(r.words)).toBe(true)
    expect(Array.isArray(r.elements)).toBe(true)
    expect(r.elements.length).toBeGreaterThan(0)
  })

  it('da_get_mouse_position handler resolves with { x, y } in mock mode', async () => {
    const result = await daGetMousePosition.handler({})
    expect(result).toEqual({ x: 0, y: 0 })
  })

  // Bonus: ALL_TOOLS contains the stubs as well.
  it('ALL_TOOLS includes every named export', () => {
    const names = new Set(ALL_TOOLS.map((t) => t.name))
    for (const { name } of SCHEDULE) {
      expect(names.has(name)).toBe(true)
    }
  })
})