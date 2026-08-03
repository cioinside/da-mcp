/**
 * OCR CLI backend (tesseract).
 *
 * Pipes the image to `${tesseractBin} stdout - -l <lang> tsv` with shell:false,
 * stdio:['ignore','pipe','pipe'], and a timeout driven by config.
 */
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import { parseTsv } from './parse.js'
import type { OCRResult } from './types.js'

export function runCli(image: Buffer, lang: string, timeoutMs: number): OCRResult {
  const tesseractBin = getConfig().tesseractBin
  const start = Date.now()
  const result = spawnSync(
    tesseractBin,
    ['stdout', '-', '-l', lang, 'tsv'],
    {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      input: image,
      timeout: timeoutMs,
      encoding: 'utf8',
    },
  )
  if (result.error !== null && result.error !== undefined) {
    const err = result.error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      throw new DaMcpError(
        'NATIVE_MISSING',
        'tesseract CLI not found on PATH. Install with: apt-get install tesseract-ocr',
        err,
      )
    }
    throw new DaMcpError('NATIVE_FAILED', err.message, err)
  }
  if (result.signal !== null && result.signal !== undefined && result.signal.length > 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `tesseract killed by signal ${result.signal} after ${String(timeoutMs)}ms`,
    )
  }
  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new DaMcpError(
      'NATIVE_FAILED',
      stderr.length > 0 ? stderr : `tesseract exited with status ${String(result.status)}`,
    )
  }
  const stdout = typeof result.stdout === 'string' ? result.stdout : ''
  const { words, lines } = parseTsv(stdout)
  return {
    source: tesseractBin,
    words,
    lines,
    elements: [],
    durationMs: Date.now() - start,
    backend: 'cli',
  }
}