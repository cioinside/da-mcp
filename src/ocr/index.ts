/**
 * OCR public dispatcher.
 *
 * Routes `runOcr` to the configured backend (mock fixture / CLI / wasm).
 * When CLI fails and wasm is also unavailable, throws OCR_FAILED with the
 * CLI error preserved as cause.
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import { runCli } from './cli.js'
import { mockResult } from './mock.js'
import type { OCRResult } from './types.js'
import { runWasm } from './wasm.js'

const DEFAULT_OCR_LANG = 'eng'

export { parseTsv } from './parse.js'
export { runCli } from './cli.js'
export { runWasm } from './wasm.js'
export { mockResult } from './mock.js'

/**
 * @param opts.image        Raw image bytes (PNG/JPEG/etc. — passed verbatim to tesseract).
 * @param opts.lang         ISO-639-2 language code (defaults to DEFAULT_OCR_LANG).
 * @param opts.displayId    Optional display id, only used for source labelling in logs.
 * @throws DaMcpError('INVALID_ARGUMENT') when `image` is missing or empty.
 * @throws DaMcpError('NATIVE_MISSING')  when tesseract CLI is missing or wasm backend is requested.
 * @throws DaMcpError('NATIVE_FAILED')   when tesseract returns non-zero or is killed.
 * @throws DaMcpError('OCR_FAILED')      when CLI and wasm backends both fail.
 */
export async function runOcr(opts: {
  readonly image: Buffer
  readonly lang?: string
  readonly displayId?: number | null
}): Promise<OCRResult> {
  const image = opts.image
  if (!Buffer.isBuffer(image) || image.length < 1) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'runOcr: opts.image must be a non-empty Buffer',
    )
  }
  const cfg = getConfig()
  if (cfg.testMode === 'mock') {
    void opts.displayId
    return mockResult()
  }
  if (cfg.ocrBackend === 'wasm') {
    throw new DaMcpError(
      'NATIVE_MISSING',
      'tesseract.js WASM backend not yet implemented in V1 (see T3.1 future work)',
    )
  }
  const lang = opts.lang ?? DEFAULT_OCR_LANG
  try {
    return runCli(image, lang, cfg.subprocessTimeoutMs)
  } catch (cliErr) {
    try {
      return await runWasm(image, lang)
    } catch {
      const detail = cliErr instanceof Error ? cliErr.message : String(cliErr)
      throw new DaMcpError(
        'OCR_FAILED',
        `OCR failed: tesseract CLI error ("${detail}") and wasm fallback unavailable`,
        cliErr,
      )
    }
  }
}