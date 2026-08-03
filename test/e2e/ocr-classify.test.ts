/**
 * End-to-end OCR pipeline: screenshot -> runOcr -> classifyUiElements -> da_ocr handler.
 * Skipped under DA_MCP_TEST_MODE=mock (no real native call needed) or when tesseract
 * is not installed; CI defaults to mock so this file is skipped by design.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'

import { runOcr } from '../../src/ocr/index.js'
import { classifyUiElements } from '../../src/ocr/classify.js'
import { screenshot } from '../../src/screenshot/index.js'
import { daOcr } from '../../src/tools/ocr.js'
import { initConfig, resetConfig, getConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Probe the host for a working `tesseract` binary. */
function hasTesseract(): boolean {
  try {
    const r = spawnSync('tesseract', ['--version'], { stdio: 'ignore', shell: false })
    return r.status === 0
  } catch {
    return false
  }
}

const ENV_KEYS = ['DA_MCP_TEST_MODE', 'DA_MCP_OCR_BACKEND'] as const
type EnvKey = (typeof ENV_KEYS)[number]
let savedEnv: Record<EnvKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: undefined, DA_MCP_OCR_BACKEND: undefined }
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})

afterEach(() => {
  resetConfig()
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe.skipIf(
  process.env['DA_MCP_TEST_MODE'] === 'mock' || !hasTesseract(),
)('ocr + classify e2e', () => {
  beforeAll(() => {
    expect(hasTesseract()).toBe(true)
  })

  it('1. runOcr in mock mode returns fixture OCRResult with lines + words', async () => {
    const result = await runOcr({ image: PNG_HEADER, displayId: null })
    expect(result.source).toBe('mock')
    expect(result.backend).toBe('cli')
    expect(Array.isArray(result.lines)).toBe(true)
    expect(result.lines.length).toBeGreaterThanOrEqual(1)
    expect(Array.isArray(result.words)).toBe(true)
    expect(result.words.length).toBeGreaterThanOrEqual(1)
    expect(typeof result.durationMs).toBe('number')
  })

  it('2. classifyUiElements maps OCR lines to UIElement[] with valid shape', async () => {
    const ocr = await runOcr({ image: PNG_HEADER, displayId: null })
    const elements = classifyUiElements(ocr.lines)
    expect(elements.length).toBeGreaterThan(0)
    for (const el of elements) {
      expect([
        'button', 'input', 'checkbox', 'label', 'radio',
        'menu', 'menu-item', 'dialog', 'window-title', 'icon', 'unknown',
      ]).toContain(el.kind)
      expect(typeof el.text).toBe('string')
      expect(el.confidence).toBeGreaterThanOrEqual(0)
      expect(el.confidence).toBeLessThanOrEqual(1)
      expect(typeof el.bbox.x).toBe('number')
      expect(typeof el.bbox.y).toBe('number')
      expect(typeof el.bbox.width).toBe('number')
      expect(typeof el.bbox.height).toBe('number')
    }
  })

  it('3. classifyUiElements kind distribution is sane for mock fixture (OK/123)', async () => {
    const ocr = await runOcr({ image: PNG_HEADER, displayId: null })
    expect(ocr.lines.length).toBeGreaterThanOrEqual(2)
    const elements = classifyUiElements(ocr.lines)
    const kinds = elements.map((e) => e.kind)
    const hasButtonOrLabel = kinds.some((k) => k === 'button' || k === 'label')
    expect(hasButtonOrLabel).toBe(true)
  })

  it('4. da_ocr tool handler in mock mode returns structured result', async () => {
    const result = (await daOcr.handler({ displayId: null, lang: 'eng' })) as {
      source: string
      backend: string
      lines: ReadonlyArray<unknown>
      words: ReadonlyArray<unknown>
      elements: ReadonlyArray<{ kind: string }>
    }
    expect(typeof result.source).toBe('string')
    expect(typeof result.backend).toBe('string')
    expect(Array.isArray(result.lines)).toBe(true)
    expect(Array.isArray(result.words)).toBe(true)
    expect(Array.isArray(result.elements)).toBe(true)
    expect(result.elements.length).toBeGreaterThanOrEqual(1)
  })

  it('5. da_ocr inputSchema rejects invalid lang (empty string)', () => {
    const r = daOcr.inputSchema.safeParse({ displayId: 0, lang: '' })
    expect(r.success).toBe(false)
  })

  it('6. da_ocr inputSchema rejects invalid displayId (-1)', () => {
    const r = daOcr.inputSchema.safeParse({ displayId: -1 })
    expect(r.success).toBe(false)
  })

  it('7. da_ocr handler accepts empty input (both fields optional)', async () => {
    const buf = await screenshot(null)
    expect(Buffer.isBuffer(buf)).toBe(true)
    const result = (await daOcr.handler({})) as { elements: ReadonlyArray<unknown> }
    expect(Array.isArray(result.elements)).toBe(true)
  })

  it('8. DA_MCP_OCR_BACKEND=cli config flag is respected', async () => {
    resetConfig()
    initConfig({ DA_MCP_OCR_BACKEND: 'cli', DA_MCP_TEST_MODE: 'mock' })
    const cfg = getConfig()
    expect(cfg.ocrBackend).toBe('cli')
    expect(cfg.testMode).toBe('mock')
    const result = await runOcr({ image: PNG_HEADER, displayId: null, lang: 'eng' })
    expect(['cli', 'mock']).toContain(result.source)
    process.env['DA_MCP_TEST_MODE'] = 'mock'
  })

  it('9. WASM backend throws DaMcpError NATIVE_MISSING; mock mode restored after', async () => {
    resetConfig()
    initConfig({ DA_MCP_OCR_BACKEND: 'wasm', DA_MCP_TEST_MODE: 'real' })
    expect(getConfig().ocrBackend).toBe('wasm')
    expect(getConfig().testMode).toBe('real')
    let caught: unknown = undefined
    try {
      await runOcr({ image: PNG_HEADER, displayId: null })
    } catch (e) {
      caught = e
    }
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('NATIVE_MISSING')
    }
    process.env['DA_MCP_TEST_MODE'] = 'mock'
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'mock' })
    expect(getConfig().testMode).toBe('mock')
  })
})
