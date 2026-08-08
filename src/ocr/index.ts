/**
 * OCR public dispatcher.
 *
 * Routes `runOcr` to the configured backend (mock fixture / CLI / wasm).
 * When CLI fails and wasm is also unavailable, throws OCR_FAILED with the
 * CLI error preserved as cause and an actionable remediation hint.
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import { getLogger } from '../log.js'
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
 * @throws DaMcpError('OCR_FAILED')      when CLI and wasm backends both fail — message
 *                                       includes both backend errors and remediation hints.
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
    return await runCli(image, lang, cfg.subprocessTimeoutMs)
  } catch (cliErr) {
    if (cliErr instanceof DaMcpError && cliErr.code === 'NATIVE_MISSING') {
      getLogger().info(
        `tesseract CLI not found on PATH; using bundled WASM fallback (slower). ` +
          `Run 'da-mcp.exe install-tesseract' for fast OCR (~0.5-2s vs ~5-15s/call).`,
        { component: 'ocr' },
      )
    } else {
      getLogger().warn(
        `tesseract CLI failed; falling back to WASM: ${cliErr instanceof Error ? cliErr.message : String(cliErr)}`,
        { component: 'ocr' },
      )
    }
    try {
      return await runWasm(image, lang)
    } catch (wasmErr) {
      throw buildOcrFailed(cliErr, wasmErr)
    }
  }
}

/**
 * Construct the OCR_FAILED error surfaced when both backends fail. Includes
 * both backend error messages and a multi-line remediation hint covering
 * the three practical paths: install Tesseract, allow internet for
 * traineddata download, or pre-bundle the traineddata (see README).
 *
 * The CLI error is preserved as `cause` for callers that inspect it
 * programmatically; the user-facing message is human-only.
 */
export function buildOcrFailed(cliErr: unknown, wasmErr: unknown): DaMcpError {
  const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr)
  const wasmMsg = wasmErr instanceof Error ? wasmErr.message : String(wasmErr)
  const message = [
    'OCR failed. Both tesseract CLI and tesseract.js WASM backends are unavailable.',
    `- Tesseract CLI: ${cliMsg}`,
    `- WASM fallback: ${wasmMsg}`,
    'To fix:',
    '  1. Install Tesseract for fast, offline OCR (recommended):',
    '     Windows:  winget install UB-Mannheim.TesseractOCR',
    '     macOS:    brew install tesseract',
    '     Linux:    apt install tesseract-ocr',
    '  2. Without Tesseract, ensure internet access on first OCR call so',
    '     tesseract.js can download its traineddata (~15 MB, cached after).',
    '  3. Set DA_MCP_TESSDATA_DIR to a writable directory if the default',
    '     location is read-only.',
  ].join('\n')
  return new DaMcpError('OCR_FAILED', message, cliErr)
}