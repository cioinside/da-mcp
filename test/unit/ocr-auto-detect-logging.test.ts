import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DaMcpError } from '../../src/errors.js'
import { initConfig, getConfig, resetConfig } from '../../src/config.js'

const { infoMock, warnMock, errorMock, runCliMock, runWasmMock } = vi.hoisted(() => ({
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
  runCliMock: vi.fn(),
  runWasmMock: vi.fn(),
}))

vi.mock('../../src/log.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/log.js')>()
  return {
    ...actual,
    getLogger: () => ({ info: infoMock, warn: warnMock, error: errorMock, debug: vi.fn(), trace: vi.fn() }),
  }
})

vi.mock('../../src/ocr/cli.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ocr/cli.js')>()
  return {
    ...actual,
    runCli: (...args: unknown[]) => runCliMock(...args),
  }
})

vi.mock('../../src/ocr/wasm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ocr/wasm.js')>()
  return {
    ...actual,
    runWasm: (...args: unknown[]) => runWasmMock(...args),
  }
})

const { runOcr } = await import('../../src/ocr/index.js')

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])

const stubResult = {
  text: 'OK',
  lines: [
    {
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      words: [{ text: 'OK', bbox: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.99 }],
      text: 'OK',
      confidence: 0.99,
    },
  ],
  confidence: 0.99,
}

describe('runOcr auto-detect logging (CLI failure → fallback)', () => {
  beforeEach(() => {
    infoMock.mockReset()
    warnMock.mockReset()
    errorMock.mockReset()
    runCliMock.mockReset()
    runWasmMock.mockReset()
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'real', DA_MCP_OCR_BACKEND: 'cli' })
    expect(getConfig().testMode).toBe('real')
    expect(getConfig().ocrBackend).toBe('cli')
  })

  afterEach(() => {
    resetConfig()
    initConfig({ DA_MCP_TEST_MODE: 'mock' })
  })

  it('logs info hint when CLI throws NATIVE_MISSING, then falls back to WASM', async () => {
    runCliMock.mockRejectedValueOnce(new DaMcpError('NATIVE_MISSING', 'tesseract CLI not on PATH'))
    runWasmMock.mockResolvedValueOnce(stubResult)

    const result = await runOcr({ image: PNG_HEADER })

    expect(result).toBe(stubResult)
    expect(infoMock).toHaveBeenCalledTimes(1)
    expect(warnMock).not.toHaveBeenCalled()
    expect(errorMock).not.toHaveBeenCalled()

    const [msg, fields] = infoMock.mock.calls[0] ?? []
    expect(typeof msg).toBe('string')
    expect(String(msg)).toContain('tesseract CLI not found')
    expect(String(msg)).toContain('install-tesseract')
    expect(fields).toEqual({ component: 'ocr' })
  })

  it('logs warn with cliErr.message when CLI throws non-NATIVE_MISSING, then falls back to WASM', async () => {
    runCliMock.mockRejectedValueOnce(new DaMcpError('NATIVE_FAILED', 'tesseract crashed with OOM'))
    runWasmMock.mockResolvedValueOnce(stubResult)

    const result = await runOcr({ image: PNG_HEADER })

    expect(result).toBe(stubResult)
    expect(warnMock).toHaveBeenCalledTimes(1)
    expect(infoMock).not.toHaveBeenCalled()
    expect(errorMock).not.toHaveBeenCalled()

    const [msg, fields] = warnMock.mock.calls[0] ?? []
    expect(typeof msg).toBe('string')
    expect(String(msg)).toContain('tesseract CLI failed')
    expect(String(msg)).toContain('tesseract crashed with OOM')
    expect(fields).toEqual({ component: 'ocr' })
  })

  it('coerces non-Error cliErr to string in warn message', async () => {
    runCliMock.mockRejectedValueOnce('plain string thrown from CLI')
    runWasmMock.mockResolvedValueOnce(stubResult)

    await runOcr({ image: PNG_HEADER })

    expect(warnMock).toHaveBeenCalledTimes(1)
    const [msg] = warnMock.mock.calls[0] ?? []
    expect(String(msg)).toContain('plain string thrown from CLI')
  })

  it('does not log on happy path (CLI succeeds)', async () => {
    runCliMock.mockResolvedValueOnce(stubResult)

    const result = await runOcr({ image: PNG_HEADER })

    expect(result).toBe(stubResult)
    expect(infoMock).not.toHaveBeenCalled()
    expect(warnMock).not.toHaveBeenCalled()
    expect(errorMock).not.toHaveBeenCalled()
  })

  it('still logs info on NATIVE_MISSING path even when WASM also fails (OCR_FAILED)', async () => {
    runCliMock.mockRejectedValueOnce(new DaMcpError('NATIVE_MISSING', 'tesseract CLI not on PATH'))
    runWasmMock.mockRejectedValueOnce(new DaMcpError('NATIVE_MISSING', 'wasm traineddata missing'))

    const caught = await runOcr({ image: PNG_HEADER }).then(
      () => undefined as unknown,
      (e: unknown) => e,
    )

    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('OCR_FAILED')
    }
    expect(infoMock).toHaveBeenCalledTimes(1)
    expect(warnMock).not.toHaveBeenCalled()
  })
})