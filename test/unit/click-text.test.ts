/**
 * Unit tests for da_click_text.
 *
 * Mocks: screenshot / runOcr / classifyUiElements / mouseMove / mouseClick so
 * the handler can be exercised end-to-end without any native bridge. The
 * module-level vi.mock() ensures the click-text module imports the mocked
 * dependencies before any test runs.
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
const mockMouseMove: Mock<[number, number], Promise<void>> = vi.fn()
const mockMouseClick: Mock<[import('../../src/platform/types.js').MouseButton, number?], Promise<void>> = vi.fn()

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

vi.mock('../../src/input/index.js', () => ({
  mouseMove: (x: number, y: number) => mockMouseMove(x, y),
  mouseClick: (button: import('../../src/platform/types.js').MouseButton, count?: number) =>
    mockMouseClick(button, count),
}))

// Import AFTER mocks so the module under test resolves the mocked deps.
const { daClickText } = await import('../../src/tools/click-text.js')

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  mockScreenshot.mockReset()
  mockRunOcr.mockReset()
  mockClassify.mockReset()
  mockMouseMove.mockReset()
  mockMouseClick.mockReset()
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

// ---------- fixture helpers ----------

function makeBbox(x: number, y: number, width: number, height: number): BoundingBox {
  return { x, y, width, height }
}

function makeElement(
  text: string,
  bbox: BoundingBox,
  confidence: number,
): UIElement {
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

// ---------- tests ----------

describe('da_click_text schema', () => {
  it('accepts canonical input { text: "OK" }', () => {
    expect(() => daClickText.inputSchema.parse({ text: 'OK' })).not.toThrow()
  })

  it('rejects empty text (min length 1)', () => {
    const result = daClickText.inputSchema.safeParse({ text: '' })
    expect(result.success).toBe(false)
  })
})

describe('da_click_text handler', () => {
  it('exact match returns the click center, bbox, confidence, and matched text', async () => {
    const elements = [
      makeElement('Cancel', makeBbox(0, 0, 80, 30), 0.7),
      makeElement('OK', makeBbox(100, 50, 60, 40), 0.95),
    ]
    mockClassify.mockReturnValue(elements)
    mockRunOcr.mockResolvedValue(makeOcrResult([]))

    const result = (await daClickText.handler({ text: 'OK' })) as {
      matched: boolean
      clicked: { x: number; y: number }
      bbox: { x: number; y: number; width: number; height: number }
      confidence: number
      text: string
    }

    expect(result.matched).toBe(true)
    // bbox.x=100, width=60 → 100 + floor(60/2)=100 + 30 = 130
    expect(result.clicked).toEqual({ x: 130, y: 70 })
    expect(result.bbox).toEqual({ x: 100, y: 50, width: 60, height: 40 })
    expect(result.confidence).toBe(0.95)
    expect(result.text).toBe('OK')

    expect(mockMouseMove).toHaveBeenCalledWith(130, 70)
    expect(mockMouseClick).toHaveBeenCalledTimes(1)
    expect(mockMouseClick.mock.calls[0]?.[0]).toBe('left')
  })

  it('fuzzy match succeeds with mixed case and extra whitespace', async () => {
    // Element text is "  Save File  " and OCR result has "Cancel" first then
    // "  Save File  "; fuzzy normalizes both sides (lowercase, trim, collapse).
    const elements = [
      makeElement('Cancel', makeBbox(0, 0, 80, 30), 0.6),
      makeElement('  Save   File  ', makeBbox(20, 80, 120, 24), 0.85),
    ]
    mockClassify.mockReturnValue(elements)

    const result = (await daClickText.handler({
      text: 'save file',
      fuzzy: true,
    })) as { clicked: { x: number; y: number }; text: string }

    // bbox.x=20, width=120 → 20 + 60 = 80; y=80 + 12 = 92
    expect(result.clicked).toEqual({ x: 80, y: 92 })
    expect(result.text).toBe('  Save   File  ')
  })

  it('fuzzy: false does NOT lowercase element text', async () => {
    const elements = [
      makeElement('OK', makeBbox(0, 0, 60, 40), 0.9),
      makeElement('Okay', makeBbox(0, 50, 60, 40), 0.9),
    ]
    mockClassify.mockReturnValue(elements)

    // 'ok' would match both in fuzzy mode but neither in exact mode (case-sensitive).
    const result = (await daClickText.handler({ text: 'OK', fuzzy: false })) as {
      text: string
    }
    expect(result.text).toBe('OK')
  })

  it('throws NOT_FOUND when no element matches', async () => {
    const elements = [
      makeElement('Cancel', makeBbox(0, 0, 80, 30), 0.7),
      makeElement('Apply', makeBbox(100, 50, 60, 40), 0.95),
    ]
    mockClassify.mockReturnValue(elements)

    const caught = await captureThrown(
      daClickText.handler({ text: 'OK' }),
    )
    assertCode(caught, 'NOT_FOUND')
    if (DaMcpError.is(caught)) {
      expect(caught.message).toContain('OK')
      expect(caught.message).toContain('fuzzy=false')
    }

    // Must NOT move or click on no-match.
    expect(mockMouseMove).not.toHaveBeenCalled()
    expect(mockMouseClick).not.toHaveBeenCalled()
  })

  it('multiple matches → picks highest confidence (first wins on ties)', async () => {
    const elements = [
      makeElement('OK', makeBbox(0, 0, 60, 40), 0.6), // earlier but lower conf
      makeElement('Confirm OK', makeBbox(200, 100, 120, 40), 0.92), // higher
      makeElement('Maybe OK', makeBbox(400, 200, 100, 40), 0.8), // mid
    ]
    mockClassify.mockReturnValue(elements)

    const result = (await daClickText.handler({ text: 'OK' })) as {
      bbox: { x: number; y: number; width: number; height: number }
      confidence: number
    }
    expect(result.confidence).toBe(0.92)
    expect(result.bbox).toEqual({ x: 200, y: 100, width: 120, height: 40 })

    // Tie-break: same confidence, earlier index wins.
    const tied = [
      makeElement('OK A', makeBbox(10, 10, 60, 40), 0.5),
      makeElement('OK B', makeBbox(100, 100, 60, 40), 0.5),
    ]
    mockClassify.mockReturnValue(tied)
    const tiedResult = (await daClickText.handler({ text: 'OK' })) as {
      bbox: { x: number; y: number; width: number; height: number }
    }
    expect(tiedResult.bbox).toEqual({ x: 10, y: 10, width: 60, height: 40 })
  })

  it('displayId is passed through to screenshot() and runOcr()', async () => {
    const elements = [makeElement('OK', makeBbox(100, 50, 60, 40), 0.95)]
    mockClassify.mockReturnValue(elements)

    await daClickText.handler({ text: 'OK', displayId: 7 })

    expect(mockScreenshot).toHaveBeenCalledTimes(1)
    expect(mockScreenshot).toHaveBeenCalledWith(7)
    expect(mockRunOcr).toHaveBeenCalledTimes(1)
    const ocrArg = mockRunOcr.mock.calls[0]?.[0] as { displayId: number | null }
    expect(ocrArg.displayId).toBe(7)
  })

  it('displayId omitted → screenshot / runOcr receive null', async () => {
    const elements = [makeElement('OK', makeBbox(0, 0, 60, 40), 0.95)]
    mockClassify.mockReturnValue(elements)

    await daClickText.handler({ text: 'OK' })

    expect(mockScreenshot).toHaveBeenCalledWith(null)
    const ocrArg = mockRunOcr.mock.calls[0]?.[0] as { displayId: number | null }
    expect(ocrArg.displayId).toBe(null)
  })

  it('click center uses Math.floor(width/2) and Math.floor(height/2)', async () => {
    // Odd dimensions: 61 x 41 → center at (5+30, 10+20) = (35, 30)
    const elements = [makeElement('X', makeBbox(5, 10, 61, 41), 0.9)]
    mockClassify.mockReturnValue(elements)

    const result = (await daClickText.handler({ text: 'X' })) as {
      clicked: { x: number; y: number }
    }
    expect(result.clicked).toEqual({ x: 35, y: 30 })
  })
})