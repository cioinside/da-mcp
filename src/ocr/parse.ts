/**
 * Tesseract TSV parser.
 *
 * Pure data transformation: stdout TSV → {words, lines}. No I/O, no spawn.
 * Kept separate from the CLI backend so the parser can be unit-tested
 * directly against fixture strings.
 */
import type { BoundingBox, OCRLine, OCRWord } from './types.js'

const TSV_COLUMNS = [
  'level',
  'page_num',
  'block_num',
  'par_num',
  'line_num',
  'word_num',
  'left',
  'top',
  'width',
  'height',
  'conf',
  'text',
] as const

function normalizeConf(raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  if (n > 100) return 1
  return n / 100
}

interface ParsedWord {
  block: number
  par: number
  line: number
  word: OCRWord
}

export function parseTsv(stdout: string): { words: OCRWord[]; lines: OCRLine[] } {
  const rows = stdout.split('\n')
  const parsed: ParsedWord[] = []
  for (const raw of rows) {
    if (raw.length === 0) continue
    const cols = raw.split('\t')
    if (cols.length < TSV_COLUMNS.length) continue
    if (cols[0] !== '5') continue
    const text = cols[11] ?? ''
    if (text.trim().length === 0) continue
    const conf = normalizeConf(cols[10] ?? '0')
    if (conf < 0.5) continue
    const left = Number(cols[6] ?? 0)
    const top = Number(cols[7] ?? 0)
    const width = Number(cols[8] ?? 0)
    const height = Number(cols[9] ?? 0)
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue
    const bbox: BoundingBox = { x: left, y: top, width, height }
    parsed.push({
      block: Number(cols[2] ?? 0),
      par: Number(cols[3] ?? 0),
      line: Number(cols[4] ?? 0),
      word: {
        text,
        bbox,
        confidence: conf,
        blockId: Number(cols[2] ?? 0),
        paragraphId: Number(cols[3] ?? 0),
        lineId: Number(cols[4] ?? 0),
        wordId: Number(cols[5] ?? 0),
      },
    })
  }
  if (parsed.length === 0) return { words: [], lines: [] }
  const groupOrder: string[] = []
  const groups = new Map<string, ParsedWord[]>()
  for (const p of parsed) {
    const key = `${String(p.block)}/${String(p.par)}/${String(p.line)}`
    let bucket = groups.get(key)
    if (bucket === undefined) {
      bucket = []
      groups.set(key, bucket)
      groupOrder.push(key)
    }
    bucket.push(p)
  }
  const words: OCRWord[] = parsed.map((p) => p.word)
  const ocrLines: OCRLine[] = []
  for (const key of groupOrder) {
    const bucket = groups.get(key)
    if (bucket === undefined || bucket.length === 0) continue
    const ws = bucket.map((p) => p.word)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let confSum = 0
    for (const w of ws) {
      if (w.bbox.x < minX) minX = w.bbox.x
      if (w.bbox.y < minY) minY = w.bbox.y
      if (w.bbox.x + w.bbox.width > maxX) maxX = w.bbox.x + w.bbox.width
      if (w.bbox.y + w.bbox.height > maxY) maxY = w.bbox.y + w.bbox.height
      confSum += w.confidence
    }
    ocrLines.push({
      text: ws.map((w) => w.text).join(' '),
      words: ws,
      bbox: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
      confidence: confSum / ws.length,
    })
  }
  return { words, lines: ocrLines }
}