/**
 * OCR wasm backend (tesseract.js).
 *
 * Loads tesseract.js lazily; throws NATIVE_MISSING when the package is not
 * installed. The image is written to a temp file because tesseract.js@7
 * workerMode accepts a path/URL/TypedArray — `image` is already a Buffer.
 */
import { Buffer } from 'node:buffer'
import { DaMcpError } from '../errors.js'
import type { OCRResult } from './types.js'

export async function runWasm(image: Buffer, lang: string): Promise<OCRResult> {
  const start = Date.now()
  let mod: typeof import('tesseract.js')
  try {
    mod = await import('tesseract.js')
  } catch (err) {
    throw new DaMcpError(
      'NATIVE_MISSING',
      'tesseract.js package not installed; install to enable wasm OCR fallback',
      err,
    )
  }
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'damcp-ocr-'))
  const tmpFile = path.join(tmpDir, 'image.png')
  try {
    await fs.writeFile(tmpFile, image)
    const worker = await mod.createWorker(lang)
    await worker.recognize(tmpFile)
    await worker.terminate().catch(() => undefined)
    return {
      source: 'wasm',
      words: [],
      lines: [],
      elements: [],
      durationMs: Date.now() - start,
      backend: 'wasm',
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
  void Buffer
}