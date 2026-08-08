import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { initConfig, getConfig, resetConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'
import { runOcr, buildOcrFailed } from '../../src/ocr/index.js'
import { runCli } from '../../src/ocr/cli.js'
import { classifyUiElements } from '../../src/ocr/classify.js'
import type { OCRLine, UIElement } from '../../src/ocr/types.js'

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

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])

describe('runOcr (mock mode)', () => {
  it('returns OCRResult with at least 2 lines', async () => {
    const result = await runOcr({ image: PNG_HEADER })
    expect(result.lines.length).toBeGreaterThanOrEqual(2)
  })

  it('fixture has OK and 123 as the first word of each line', async () => {
    const result = await runOcr({ image: PNG_HEADER })
    const first = result.lines[0]
    const second = result.lines[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    expect(first.words[0]?.text).toBe('OK')
    expect(second.words[0]?.text).toBe('123')
  })

  it('rejects empty image buffer with INVALID_ARGUMENT', async () => {
    const caught = await captureThrown(runOcr({ image: Buffer.alloc(0) }))
    assertCode(caught, 'INVALID_ARGUMENT')
  })

  it('rejects non-Buffer image with INVALID_ARGUMENT', async () => {
    const caught = await captureThrown(
      runOcr({ image: 'not-a-buffer' as unknown as Buffer }),
    )
    assertCode(caught, 'INVALID_ARGUMENT')
  })
})

describe('classifyUiElements', () => {
  it('returns at least one UIElement for the OCR fixture lines', async () => {
    const result = await runOcr({ image: PNG_HEADER })
    const elements = classifyUiElements(result.lines)
    expect(elements.length).toBeGreaterThanOrEqual(1)
    for (const el of elements) {
      expect(el.bbox.width).toBeGreaterThan(0)
      expect(el.bbox.height).toBeGreaterThan(0)
    }
  })

  it('classifies a short-text high-aspect line as button or label with confidence > 0.5', () => {
    const line: OCRLine = {
      bbox: { x: 10, y: 10, width: 80, height: 20 },
      words: [
        { text: 'OK', bbox: { x: 10, y: 10, width: 40, height: 20 }, confidence: 0.95 },
      ],
      text: 'OK',
      confidence: 0.95,
    }
    const [el] = classifyUiElements([line])
    expect(el).toBeDefined()
    if (el === undefined) return
    expect(['button', 'label']).toContain(el.kind)
    expect(el.confidence).toBeGreaterThan(0.5)
  })

  it('returns an empty array for empty input', () => {
    const result: readonly UIElement[] = classifyUiElements([])
    expect(result.length).toBe(0)
  })

  it('preserves input order and emits one element per line', () => {
    const lines: OCRLine[] = [
      {
        bbox: { x: 0, y: 0, width: 50, height: 20 },
        words: [{ text: 'A', bbox: { x: 0, y: 0, width: 25, height: 20 }, confidence: 0.9 }],
        text: 'A',
        confidence: 0.9,
      },
      {
        bbox: { x: 0, y: 30, width: 60, height: 20 },
        words: [{ text: 'B', bbox: { x: 0, y: 30, width: 30, height: 20 }, confidence: 0.9 }],
        text: 'B',
        confidence: 0.9,
      },
      {
        bbox: { x: 0, y: 60, width: 70, height: 20 },
        words: [{ text: 'C', bbox: { x: 0, y: 60, width: 35, height: 20 }, confidence: 0.9 }],
        text: 'C',
        confidence: 0.9,
      },
    ]
    const elements = classifyUiElements(lines)
    expect(elements.length).toBe(3)
    expect(elements[0]?.bbox.y).toBe(0)
    expect(elements[1]?.bbox.y).toBe(30)
    expect(elements[2]?.bbox.y).toBe(60)
  })
})

describe('runOcr OCR_FAILED (CLI ENOENT + wasm unavailable)', () => {
  it('throws DaMcpError OCR_FAILED with cliErr as cause when both backends fail', async () => {
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'real', DA_MCP_OCR_BACKEND: 'cli' })
    expect(getConfig().testMode).toBe('real')
    expect(getConfig().ocrBackend).toBe('cli')

    vi.doMock('node:child_process', async () => {
      const actual =
        await vi.importActual<typeof import('node:child_process')>('node:child_process')
      return {
        ...actual,
        spawn: () => {
          const ee = new EventEmitter()
          Object.assign(ee, {
            stdin: { on: () => {}, end: () => {} },
            stdout: { on: () => {} },
            stderr: { on: () => {} },
            pid: 0,
            kill: () => true,
          })
          process.nextTick(() => {
            ee.emit(
              'error',
              Object.assign(new Error('spawn tesseract ENOENT'), {
                code: 'ENOENT' as const,
              }),
            )
          })
          return ee
        },
      }
    })

    vi.doMock('tesseract.js', () => {
      throw new Error("Cannot find module 'tesseract.js'")
    })

    try {
      const caught = await captureThrown(runOcr({ image: PNG_HEADER }))
      assertCode(caught, 'OCR_FAILED')
      if (DaMcpError.is(caught)) {
        expect(caught.message).toContain('OCR failed')
        expect(caught.message).toContain('Install Tesseract')
        expect(caught.message).toContain('winget install UB-Mannheim.TesseractOCR')
        expect(caught.message).toContain('brew install tesseract')
        expect(caught.message).toContain('apt install tesseract-ocr')
        expect(caught.message).toContain('~15 MB')
        expect(caught.message).toContain('DA_MCP_TESSDATA_DIR')
        expect(caught.message).toMatch(/Tesseract CLI: /)
        expect(caught.message).toMatch(/WASM fallback: /)
        expect(caught.cause).toBeInstanceOf(Error)
      }
    } finally {
      vi.doUnmock('node:child_process')
      vi.doUnmock('tesseract.js')
      resetConfig()
      initConfig({ DA_MCP_TEST_MODE: 'mock' })
    }
  })
})

describe('buildOcrFailed (OCR_FAILED message builder)', () => {
  it('produces DaMcpError OCR_FAILED with both backend messages and remediation hints', () => {
    const cliErr = new Error('tesseract CLI not found on PATH. Install with: apt-get install tesseract-ocr')
    const wasmErr = new Error('Failed to fetch traineddata: network unreachable')
    const out = buildOcrFailed(cliErr, wasmErr)
    expect(out).toBeInstanceOf(DaMcpError)
    expect(out.code).toBe('OCR_FAILED')
    expect(out.cause).toBe(cliErr)
    expect(out.message).toContain('OCR failed.')
    expect(out.message).toContain(cliErr.message)
    expect(out.message).toContain(wasmErr.message)
    expect(out.message).toContain('winget install UB-Mannheim.TesseractOCR')
    expect(out.message).toContain('brew install tesseract')
    expect(out.message).toContain('apt install tesseract-ocr')
    expect(out.message).toContain('internet access')
    expect(out.message).toContain('DA_MCP_TESSDATA_DIR')
  })

  it('coerces non-Error cliErr / wasmErr to string for the message', () => {
    const out = buildOcrFailed('plain string cliErr', { code: 'ECONNRESET' })
    expect(out.code).toBe('OCR_FAILED')
    expect(out.message).toContain('plain string cliErr')
    expect(out.message).toContain('[object Object]')
    expect(out.cause).toBe('plain string cliErr')
  })

  it('handles null / undefined error values without throwing', () => {
    expect(() => buildOcrFailed(null, undefined)).not.toThrow()
    const out = buildOcrFailed(null, undefined)
    expect(out.code).toBe('OCR_FAILED')
    expect(out.message).toContain('null')
    expect(out.message).toContain('undefined')
  })

  it('exported from src/ocr/index.js', () => {
    expect(typeof buildOcrFailed).toBe('function')
  })
})

describe('runCli async contract (regression for #28 bug 2)', () => {
  it('returns a Promise so the Node event loop is not blocked during spawn', async () => {
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'real' })

    const promise = runCli(PNG_HEADER, 'eng', 1000)
    expect(promise).toBeInstanceOf(Promise)

    let ticked = false
    setTimeout(() => {
      ticked = true
    }, 10)

    await promise.catch(() => {
      void 0
    })

    expect(ticked).toBe(true)
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'mock' })
  })
})