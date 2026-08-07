/**
 * Unit tests for da_find_text.
 *
 * Mirrors the da_click_text mock pattern: screenshot / runOcr / classifyUiElements
 * are stubbed via vi.mock so the handler runs end-to-end against deterministic
 * fixtures without touching native bridges.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vitest'

import { DaMcpError } from '../../src/errors.js'
import type { BoundingBox, OCRResult, UIElement } from '../../src/ocr/types.js'

const mockScreenshot: Mock<[number | null], Promise<Buffer>> = vi.fn()
const mockRunOcr: Mock<
  [{ image: Buffer; displayId: number | null }],
  Promise<OCRResult>
> = vi.fn()
const mockClassify: Mock<[readonly import('../../src/ocr/types.js').OCRLine[]], readonly UIElement[]> = vi.fn()

vi.mock('../../src/screenshot/index.js', () => ({
  screenshot: (displayId: number | null) => mockScreenshot(displayId),
}))

vi.mock('../../src/ocr/index.js', () => ({
  runOcr: (opts: { image: Buffer; displayId: number | null }) => mockRunOcr(opts),
}))

vi.mock('../../src/ocr/classify.js', () => ({
  classifyUiElements: (lines: readonly import('../../src/ocr/types.js').OCRLine[]) =>
    mockClassify(lines),
}))

// Import AFTER mocks so the module under test resolves the mocked deps.
const { daFindText } = await import('../../src/tools/find-text.js')

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  mockScreenshot.mockReset()
  mockRunOcr.mockReset()
  mockClassify.mockReset()
  mockScreenshot.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  mockRunOcr.mockResolvedValue(makeOcrResult([]))
  mockClassify.mockImplementation((lines) => lines.map((l) => elementFromLine(l)))
})

afterEach(() => {
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

function makeBbox(x: number, y: number, width: number, height: number): BoundingBox {
  return { x, y, width, height }
}

function makeElement(text: string, bbox: BoundingBox, confidence: number): UIElement {
  return {
    kind: 'button',
    text,
    confidence,
    bbox,
    sourceWordIndices: [],
  }
}

function makeOcrResult(
  lines: ReadonlyArray<{ text: string; bbox: BoundingBox; confidence: number }>,
): OCRResult {
  return {
    source: 'mock',
    words: [],
    lines: lines.map((l) => ({
      text: l.text,
      words: [],
      bbox: l.bbox,
      confidence: l.confidence,
    })),
    elements: [],
    durationMs: 1,
    backend: 'cli',
  }
}

function elementFromLine(line: { text: string; bbox: BoundingBox; confidence: number }): UIElement {
  return makeElement(line.text, line.bbox, line.confidence)
}

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

describe('da_find_text schema', () => {
  it('accepts canonical input { text: "OK" }', () => {
    expect(() => daFindText.inputSchema.parse({ text: 'OK' })).not.toThrow()
  })

  it('rejects empty text (min length 1)', () => {
    const result = daFindText.inputSchema.safeParse({ text: '' })
    expect(result.success).toBe(false)
  })

  it('accepts fuzzy + displayId', () => {
    expect(() =>
      daFindText.inputSchema.parse({ text: 'OK', fuzzy: true, displayId: 0 }),
    ).not.toThrow()
  })
})

describe('da_find_text handler', () => {
  it('returns bbox + center + confidence + text without performing a click', async () => {
    const elements = [makeElement('OK', makeBbox(100, 50, 60, 40), 0.95)]
    mockClassify.mockReturnValue(elements)

    const result = (await daFindText.handler({ text: 'OK' })) as {
      matched: boolean
      bbox: { x: number; y: number; width: number; height: number }
      center: { x: number; y: number }
      confidence: number
      text: string
    }

    expect(result.matched).toBe(true)
    expect(result.bbox).toEqual({ x: 100, y: 50, width: 60, height: 40 })
    expect(result.center).toEqual({ x: 130, y: 70 })
    expect(result.confidence).toBe(0.95)
    expect(result.text).toBe('OK')

    // Critical: no click. We rely on the absence of mouseMove/mouseClick
    // being verified at runtime — this test does NOT import mouseMove/mouseClick
    // mocks because da_find_text must not import them at all.
  })

  it('fuzzy match succeeds with case + whitespace normalization', async () => {
    const elements = [makeElement('  Save   File  ', makeBbox(20, 80, 120, 24), 0.85)]
    mockClassify.mockReturnValue(elements)

    const result = (await daFindText.handler({
      text: 'save file',
      fuzzy: true,
    })) as { text: string; center: { x: number; y: number } }

    expect(result.text).toBe('  Save   File  ')
    expect(result.center).toEqual({ x: 80, y: 92 })
  })

  it('throws NOT_FOUND when no element matches', async () => {
    const elements = [
      makeElement('Cancel', makeBbox(0, 0, 80, 30), 0.7),
      makeElement('Apply', makeBbox(100, 50, 60, 40), 0.95),
    ]
    mockClassify.mockReturnValue(elements)

    const caught = await captureThrown(daFindText.handler({ text: 'OK' }))
    assertCode(caught, 'NOT_FOUND')
  })

  it('multiple matches → picks highest confidence (first wins on ties)', async () => {
    const elements = [
      makeElement('OK', makeBbox(0, 0, 60, 40), 0.6),
      makeElement('Confirm OK', makeBbox(200, 100, 120, 40), 0.92),
    ]
    mockClassify.mockReturnValue(elements)

    const result = (await daFindText.handler({ text: 'OK' })) as {
      bbox: { x: number; y: number; width: number; height: number }
      confidence: number
    }
    expect(result.confidence).toBe(0.92)
    expect(result.bbox).toEqual({ x: 200, y: 100, width: 120, height: 40 })
  })

  it('displayId is forwarded to screenshot and runOcr', async () => {
    const elements = [makeElement('OK', makeBbox(0, 0, 60, 40), 0.9)]
    mockClassify.mockReturnValue(elements)

    await daFindText.handler({ text: 'OK', displayId: 3 })

    expect(mockScreenshot).toHaveBeenCalledWith(3)
    const ocrArg = mockRunOcr.mock.calls[0]?.[0] as { displayId: number | null }
    expect(ocrArg.displayId).toBe(3)
  })
})