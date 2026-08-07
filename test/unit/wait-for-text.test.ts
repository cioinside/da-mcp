/**
 * Unit tests for da_wait_for_text.
 *
 * Mocks the OCR pipeline (screenshot / runOcr / classifyUiElements) the same
 * way as click-text / find-text tests. The test scenarios focus on the
 * polling + retry behavior since that's the distinguishing capability of
 * this tool.
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

const { daWaitForText } = await import('../../src/tools/wait-for-text.js')

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
  return { kind: 'button', text, confidence, bbox, sourceWordIndices: [] }
}

function makeOcrResult(
  lines: ReadonlyArray<{ text: string; bbox: BoundingBox; confidence: number }>,
): OCRResult {
  return {
    source: 'mock',
    words: [],
    lines: lines.map((l) => ({ text: l.text, words: [], bbox: l.bbox, confidence: l.confidence })),
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

describe('da_wait_for_text schema', () => {
  it('accepts canonical input', () => {
    expect(() => daWaitForText.inputSchema.parse({ text: 'OK' })).not.toThrow()
  })

  it('accepts fuzzy + displayId + timeoutMs + intervalMs', () => {
    expect(() =>
      daWaitForText.inputSchema.parse({
        text: 'Save',
        fuzzy: true,
        displayId: 0,
        timeoutMs: 1000,
        intervalMs: 50,
      }),
    ).not.toThrow()
  })

  it('rejects timeoutMs above the 60000ms cap', () => {
    expect(
      daWaitForText.inputSchema.safeParse({ text: 'X', timeoutMs: 120000 }).success,
    ).toBe(false)
  })

  it('rejects intervalMs above the 5000ms cap', () => {
    expect(
      daWaitForText.inputSchema.safeParse({ text: 'X', intervalMs: 10000 }).success,
    ).toBe(false)
  })
})

describe('da_wait_for_text handler', () => {
  it('returns the matched element immediately on the first poll', async () => {
    mockClassify.mockReturnValue([
      makeElement('Save', makeBbox(10, 10, 60, 40), 0.95),
    ])

    const result = (await daWaitForText.handler({ text: 'Save' })) as {
      found: boolean
      text: string
      bbox: { x: number; y: number; width: number; height: number }
      center: { x: number; y: number }
      attempts: number
    }

    expect(result.found).toBe(true)
    expect(result.text).toBe('Save')
    expect(result.bbox).toEqual({ x: 10, y: 10, width: 60, height: 40 })
    expect(result.center).toEqual({ x: 40, y: 30 })
    expect(result.attempts).toBe(1)
  })

  it('retries on NOT_FOUND and returns once a later poll matches', async () => {
    let polls = 0
    mockClassify.mockImplementation(() => {
      polls++
      return polls >= 3
        ? [makeElement('Done', makeBbox(50, 50, 100, 40), 0.9)]
        : []
    })

    const result = (await daWaitForText.handler({
      text: 'Done',
      timeoutMs: 2000,
      intervalMs: 50,
    })) as { attempts: number; center: { x: number; y: number } }

    expect(result.attempts).toBe(3)
    expect(result.center).toEqual({ x: 100, y: 70 })
  })

  it('throws NOT_FOUND on timeout', async () => {
    mockClassify.mockReturnValue([])

    const caught = await captureThrown(
      daWaitForText.handler({ text: 'Ghost', timeoutMs: 100, intervalMs: 50 }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NOT_FOUND')
      expect(caught.message).toContain('Ghost')
    }
  })

  it('propagates non-NOT_FOUND errors immediately (does not retry)', async () => {
    mockRunOcr.mockRejectedValue(
      new DaMcpError('OCR_FAILED', 'tesseract missing'),
    )

    const caught = await captureThrown(
      daWaitForText.handler({ text: 'OK', timeoutMs: 1000, intervalMs: 50 }),
    )
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('OCR_FAILED')
    }
    // Should not have polled multiple times — single failure propagates.
    expect(mockRunOcr).toHaveBeenCalledTimes(1)
  })

  it('fuzzy match uses normalized whitespace + case', async () => {
    mockClassify.mockReturnValue([
      makeElement('  SAVE   FILE  ', makeBbox(0, 0, 100, 30), 0.85),
    ])
    const result = (await daWaitForText.handler({
      text: 'save file',
      fuzzy: true,
    })) as { text: string }
    expect(result.text).toBe('  SAVE   FILE  ')
  })
})