import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Buffer } from 'node:buffer'
import { mkdtemp, writeFile, stat, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getBundledTessdataB64,
  decodeBundledTessdata,
  ensureBundledTessdata,
} from '../../src/ocr/bundled-tessdata.js'

const ENV_KEY = 'DA_MCP_BUNDLED_TESSDATA_B64'
let saved: string | undefined
let tmpDir = ''

beforeEach(async () => {
  saved = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  tmpDir = await mkdtemp(join(tmpdir(), 'damcp-bundled-'))
})

afterEach(async () => {
  if (saved === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = saved
  if (tmpDir !== '') {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
})

// 2 MB payload — well above MIN_VALID_BYTES so the module accepts it.
const VALID_PAYLOAD = Buffer.alloc(2 * 1024 * 1024, 0x41) // 0x41 = 'A'
const VALID_B64 = VALID_PAYLOAD.toString('base64')

describe('getBundledTessdataB64', () => {
  it('returns null when env var is unset', () => {
    expect(getBundledTessdataB64()).toBeNull()
  })

  it('returns null when env var is empty string', () => {
    process.env[ENV_KEY] = ''
    expect(getBundledTessdataB64()).toBeNull()
  })

  it('returns the env string when set', () => {
    process.env[ENV_KEY] = 'abc'
    expect(getBundledTessdataB64()).toBe('abc')
  })
})

describe('decodeBundledTessdata', () => {
  it('returns null for null input', () => {
    expect(decodeBundledTessdata(null)).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(decodeBundledTessdata('')).toBeNull()
  })

  it('returns null for non-base64 garbage below size threshold', () => {
    // Buffer.from('garbage', 'base64') returns 0 bytes — well below MIN_VALID_BYTES.
    expect(decodeBundledTessdata('garbage')).toBeNull()
  })

  it('decodes valid base64 to expected bytes', () => {
    const decoded = decodeBundledTessdata(VALID_B64)
    expect(decoded).not.toBeNull()
    expect(decoded?.length).toBe(VALID_PAYLOAD.length)
    expect(decoded?.[0]).toBe(0x41)
  })
})

describe('ensureBundledTessdata', () => {
  it('returns false when bundled base64 is not set', async () => {
    const result = await ensureBundledTessdata(tmpDir, 'eng')
    expect(result).toBe(false)
    // No file should have been created.
    await expect(stat(join(tmpDir, 'eng.traineddata'))).rejects.toThrow()
  })

  it('returns false when bundled base64 is present but invalid', async () => {
    process.env[ENV_KEY] = 'not-valid-base64'
    const result = await ensureBundledTessdata(tmpDir, 'eng')
    expect(result).toBe(false)
  })

  it('writes file when valid base64 is provided and target dir does not exist', async () => {
    process.env[ENV_KEY] = VALID_B64
    const result = await ensureBundledTessdata(tmpDir, 'eng')
    expect(result).toBe(true)

    const written = await readFile(join(tmpDir, 'eng.traineddata'))
    expect(written.length).toBe(VALID_PAYLOAD.length)
    expect(written[0]).toBe(0x41)
  })

  it('is a no-op when file already exists with valid size', async () => {
    // Pre-populate with a sentinel payload that's different from VALID_PAYLOAD.
    const sentinel = Buffer.from('PRE-EXISTING-FILE-MARKER-XXX')
    await writeFile(join(tmpDir, 'eng.traineddata'), sentinel)
    // Make it large enough to satisfy MIN_VALID_BYTES check.
    const big = Buffer.concat([sentinel, Buffer.alloc(2 * 1024 * 1024 - sentinel.length, 0x5a)])
    await writeFile(join(tmpDir, 'eng.traineddata'), big)

    process.env[ENV_KEY] = VALID_B64 // 0x41 bytes — would overwrite if code is wrong
    const result = await ensureBundledTessdata(tmpDir, 'eng')
    expect(result).toBe(true)

    const after = await readFile(join(tmpDir, 'eng.traineddata'))
    // Should still contain the sentinel prefix, NOT the 0x41 payload.
    expect(after.subarray(0, sentinel.length).toString()).toBe(sentinel.toString())
    expect(after[0]).toBe(0x50) // 'P' from sentinel, NOT 0x41 from VALID_PAYLOAD
  })

  it('overwrites an existing 0-byte file (treats as missing)', async () => {
    await writeFile(join(tmpDir, 'eng.traineddata'), Buffer.alloc(0))
    process.env[ENV_KEY] = VALID_B64
    const result = await ensureBundledTessdata(tmpDir, 'eng')
    expect(result).toBe(true)
    const after = await stat(join(tmpDir, 'eng.traineddata'))
    expect(after.size).toBe(VALID_PAYLOAD.length)
  })

  it('creates the directory if it does not exist', async () => {
    process.env[ENV_KEY] = VALID_B64
    const nested = join(tmpDir, 'a', 'b', 'c')
    const result = await ensureBundledTessdata(nested, 'eng')
    expect(result).toBe(true)
    const st = await stat(join(nested, 'eng.traineddata'))
    expect(st.size).toBe(VALID_PAYLOAD.length)
  })

  it('honors the lang parameter — writes <lang>.traineddata', async () => {
    process.env[ENV_KEY] = VALID_B64
    const result = await ensureBundledTessdata(tmpDir, 'fra')
    expect(result).toBe(true)
    const st = await stat(join(tmpDir, 'fra.traineddata'))
    expect(st.size).toBe(VALID_PAYLOAD.length)
  })
})