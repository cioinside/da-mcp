/**
 * Bundled tesseract traineddata extraction.
 *
 * In source dev mode (`npm run dev` / `npm start`), the SEA --define is empty
 * and `getBundledTessdataB64()` returns null — `ensureBundledTessdata` is a
 * no-op and tesseract.js falls back to its own download (or the CLI backend
 * never reaches this code path).
 *
 * In the SEA binary, `scripts/build-sea.sh` base64-encodes `assets/eng.traineddata`
 * and injects it as `process.env.DA_MCP_BUNDLED_TESSDATA_B64` via esbuild
 * `--define`. At first WASM init we decode the base64 string and write it
 * to `<tessdataDir>/<lang>.traineddata`, then point tesseract.js at that
 * directory via `langPath`. This makes OCR offline-by-default on first use.
 *
 * The write is idempotent: if the file already exists with a non-trivial size
 * we skip extraction (subsequent runs in the same install are no-ops).
 *
 * Size threshold is 1MB because the real eng.traineddata is ~22MB; we use
 * 1MB as a safe "definitely populated" floor. A 0-byte file is treated as
 * "missing" and re-extracted.
 */
import { Buffer } from 'node:buffer'
import { mkdir, writeFile, stat, chmod } from 'node:fs/promises'
import { join } from 'node:path'

/** Minimum file size considered "present" — well below the real ~22MB asset. */
const MIN_VALID_BYTES = 1 * 1024 * 1024

/**
 * Returns the base64-encoded traineddata string injected at bundle time, or
 * null when running in source mode (no `--define` was passed).
 *
 * Exposed for tests and for `runWasm` to detect whether extraction is worth
 * attempting — passing the empty default through Buffer.from() would yield
 * a 0-byte file and we'd re-extract on every invocation.
 */
export function getBundledTessdataB64(): string | null {
  const v = process.env['DA_MCP_BUNDLED_TESSDATA_B64']
  if (v === undefined || v.length === 0) return null
  return v
}

/**
 * Decode the bundled base64 string to raw bytes. Returns null when the
 * bundled asset is unavailable (dev source mode) or when the input is empty.
 *
 * On invalid base64 we return null rather than throw — tesseract.js still
 * gets a clean `createWorker` call and falls back to its own download.
 */
export function decodeBundledTessdata(b64: string | null): Buffer | null {
  if (b64 === null || b64.length === 0) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    // Buffer.from('not-valid-base64', 'base64') does NOT throw — it silently
    // drops non-base64 padding chars. We require at least 1MB of decoded
    // bytes to consider the decode valid; below that, the define input is
    // likely corrupted and we should let tesseract.js try to download.
    if (buf.length < MIN_VALID_BYTES) return null
    return buf
  } catch {
    return null
  }
}

/**
 * Extract the bundled traineddata to `tessdataDir/<lang>.traineddata` so
 * tesseract.js can load it locally. Safe to call repeatedly; existing
 * non-empty files are left untouched.
 *
 * Returns:
 *   - true when the file exists at the end (either pre-existing or freshly
 *     written). `runWasm` treats this as success.
 *   - false when extraction was skipped or failed (no bundled data, write
 *     error, etc.). `runWasm` should fall through to tesseract.js's own
 *     download path in that case.
 */
export async function ensureBundledTessdata(
  tessdataDir: string,
  lang: string,
): Promise<boolean> {
  const target = join(tessdataDir, `${lang}.traineddata`)
  try {
    const existing = await stat(target).catch(() => null)
    if (existing !== null && existing.isFile() && existing.size >= MIN_VALID_BYTES) {
      return true
    }
  } catch {
    // stat already swallowed ENOENT; treat any other failure as "not present".
  }

  const buf = decodeBundledTessdata(getBundledTessdataB64())
  if (buf === null) return false

  try {
    await mkdir(tessdataDir, { recursive: true })
    await writeFile(target, buf)
    await chmod(target, 0o644).catch(() => undefined)
    process.stderr.write(
      `bundled tessdata: extracted ${lang}.traineddata (${buf.length} bytes) to ${tessdataDir}\n`,
    )
    return true
  } catch {
    return false
  }
}
