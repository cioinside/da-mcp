/**
 * OCR wasm backend (tesseract.js).
 *
 * Loads tesseract.js lazily; throws NATIVE_MISSING when the package is not
 * installed. The image is written to a temp file because tesseract.js@7
 * workerMode accepts a path/URL/TypedArray — `image` is already a Buffer.
 *
 * BUG HISTORY: prior version called `worker.recognize(tmpFile)` but discarded
 * the result, returning empty arrays — so OCR ran for ~13s and returned
 * nothing. The default `output` for `recognize` in tesseract.js@7 is
 * `{ text: true }` only, which makes `data.blocks = null`. We pass
 * `{ text: true, blocks: true }` so the structured hierarchy is populated,
 * then flatten Page → OCRLine/OCRWord for the existing pipeline.
 */
import { DaMcpError } from '../errors.js'
import type { OCRLine, OCRResult, OCRWord } from './types.js'

/**
 * Subset of the tesseract.js Page shape we actually consume. The library's
 * index.d.ts exposes the full structure but we keep this loose to avoid
 * breakage on minor field additions.
 */
interface TesseractBbox {
  x0: number
  y0: number
  x1: number
  y1: number
}
interface TesseractWord {
  text: string
  confidence: number // 0..100
  bbox: TesseractBbox
}
interface TesseractLine {
  text: string
  confidence: number
  bbox: TesseractBbox
  words?: TesseractWord[] | null
}
interface TesseractParagraph {
  lines?: TesseractLine[] | null
}
interface TesseractBlock {
  paragraphs?: TesseractParagraph[] | null
}
interface TesseractPage {
  blocks?: TesseractBlock[] | null
}

function normalizeConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  // Tesseract returns 0..100; we surface 0..1.
  const clamped = Math.max(0, Math.min(100, raw))
  return clamped / 100
}

function bboxToRect(b: TesseractBbox): {
  x: number
  y: number
  width: number
  height: number
} {
  const width = Math.max(0, b.x1 - b.x0)
  const height = Math.max(0, b.y1 - b.y0)
  return { x: b.x0, y: b.y0, width, height }
}

function flattenPage(page: TesseractPage): {
  words: OCRWord[]
  lines: OCRLine[]
} {
  const words: OCRWord[] = []
  const lines: OCRLine[] = []
  const blocks = page.blocks
  if (!Array.isArray(blocks)) return { words, lines }
  for (let bi = 0; bi < blocks.length; bi += 1) {
    const block = blocks[bi]
    const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : []
    for (let pi = 0; pi < paragraphs.length; pi += 1) {
      const para = paragraphs[pi]
      const tlines = Array.isArray(para?.lines) ? para.lines : []
      for (let li = 0; li < tlines.length; li += 1) {
        const tline = tlines[li]
        if (tline === undefined || tline === null) continue
        const twords = Array.isArray(tline.words) ? tline.words : []
        const oWords: OCRWord[] = twords.map((tw, wi) => ({
          text: typeof tw.text === 'string' ? tw.text : '',
          confidence: normalizeConfidence(tw.confidence),
          bbox: bboxToRect(tw.bbox),
          blockId: bi,
          paragraphId: pi,
          lineId: li,
          wordId: wi,
        }))
        words.push(...oWords)
        lines.push({
          text: typeof tline.text === 'string' ? tline.text : '',
          confidence: normalizeConfidence(tline.confidence),
          bbox: bboxToRect(tline.bbox),
          words: oWords,
        })
      }
    }
  }
  return { words, lines }
}

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
  let worker: Awaited<ReturnType<typeof mod.createWorker>> | null = null
  try {
    await fs.writeFile(tmpFile, image)
    worker = await mod.createWorker(lang)
    // Default output in tesseract.js@7 is `{ text: true }` only — `data.blocks`
    // is null without this flag. Request both so we can flatten the hierarchy.
    const result = await worker.recognize(tmpFile, {}, { text: true, blocks: true })
    const page = (result?.data ?? {}) as TesseractPage
    const { words, lines } = flattenPage(page)
    return {
      source: 'wasm',
      words,
      lines,
      elements: [],
      durationMs: Date.now() - start,
      backend: 'wasm',
    }
  } finally {
    if (worker !== null) {
      await worker.terminate().catch(() => undefined)
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}