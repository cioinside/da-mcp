/**
 * OCR CLI backend (tesseract).
 *
 * Pipes the image to `${tesseractBin} stdout - -l <lang> tsv` via async spawn
 * with shell:false and stdio:['pipe','pipe','pipe']. On Windows the default
 * pipe buffer is 64 KB; using `spawnSync({ input: image })` would block the
 * Node event loop for the entire flush window, freezing the MCP stdio
 * transport and tripping its -32000 'Connection closed' guard. Async spawn
 * lets libuv queue the write in userspace and yield to the event loop while
 * tesseract reads, so the transport stays responsive.
 */
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import { parseTsv } from './parse.js'
import type { OCRResult } from './types.js'

export async function runCli(
  image: Buffer,
  lang: string,
  timeoutMs: number,
): Promise<OCRResult> {
  const tesseractBin = getConfig().tesseractBin
  const start = Date.now()

  return new Promise<OCRResult>((resolve, reject) => {
    let child
    try {
      child = spawn(tesseractBin, ['stdout', '-', '-l', lang, 'tsv'], {
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      const error = err as NodeJS.ErrnoException
      if (error.code === 'ENOENT') {
        reject(
          new DaMcpError(
            'NATIVE_MISSING',
            'tesseract CLI not found on PATH. Install with: apt-get install tesseract-ocr',
            error,
          ),
        )
        return
      }
      reject(new DaMcpError('NATIVE_FAILED', error.message, error))
      return
    }

    let stdout = ''
    let stderr = ''
    let killed = false

    const timer = setTimeout(() => {
      killed = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(
          new DaMcpError(
            'NATIVE_MISSING',
            'tesseract CLI not found on PATH. Install with: apt-get install tesseract-ocr',
            err,
          ),
        )
        return
      }
      reject(new DaMcpError('NATIVE_FAILED', err.message, err))
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer)
      if (killed) {
        reject(
          new DaMcpError(
            'NATIVE_FAILED',
            `tesseract killed by signal ${signal ?? 'SIGKILL'} after ${String(timeoutMs)}ms`,
          ),
        )
        return
      }
      if (code !== 0) {
        const trimmed = stderr.trim()
        reject(
          new DaMcpError(
            'NATIVE_FAILED',
            trimmed.length > 0 ? trimmed : `tesseract exited with status ${String(code)}`,
          ),
        )
        return
      }
      const { words, lines } = parseTsv(stdout)
      resolve({
        source: tesseractBin,
        words,
        lines,
        elements: [],
        durationMs: Date.now() - start,
        backend: 'cli',
      })
    })

    // Async write the image bytes to tesseract's stdin. `child.stdin.end(image)`
    // queues the entire buffer into libuv's write queue and signals EOF once
    // the data has flushed to the kernel pipe. Event loop stays responsive.
    // Swallow EPIPE here — when tesseract dies early, the 'close' handler
    // surfaces the real error from stderr.
    child.stdin?.on('error', (_err: NodeJS.ErrnoException) => {
      // intentional no-op; 'close' will report the underlying failure.
    })
    if (child.stdin) {
      child.stdin.end(image)
    } else {
      clearTimeout(timer)
      reject(new DaMcpError('NATIVE_FAILED', 'failed to open tesseract stdin'))
    }
  })
}
