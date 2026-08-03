import { describe, it, expect } from 'vitest'
import {
  DaMcpError,
  toDaMcpError,
  toMcpErrorContent,
  ERROR_CODE_MESSAGES,
  type ErrorCode,
} from '../../src/errors.js'

describe('DaMcpError', () => {
  it('carries code, message, cause', () => {
    const cause = new Error('orig')
    const err = new DaMcpError('OUT_OF_BOUNDS', 'too far', cause)
    expect(err.code).toBe('OUT_OF_BOUNDS')
    expect(err.message).toBe('too far')
    expect(err.cause).toBe(cause)
  })

  it('toJSON serializes all fields', () => {
    const json = JSON.stringify(new DaMcpError('ENOENT', 'x'))
    expect(json).toContain('"code":"ENOENT"')
    expect(json).toContain('"message":"x"')
  })

  it('is narrows', () => {
    expect(DaMcpError.is(new DaMcpError('X', 'y'))).toBe(true)
    expect(DaMcpError.is('plain')).toBe(false)
    expect(DaMcpError.is(new Error('e'))).toBe(false)
    expect(DaMcpError.is(null)).toBe(false)
  })

  it('stack starts with DaMcpError', () => {
    const err = new DaMcpError('X', 'y')
    expect(err.stack?.startsWith('DaMcpError:')).toBe(true)
  })
})

describe('toDaMcpError', () => {
  it('wraps plain Error with fallback code', () => {
    const wrapped = toDaMcpError(new Error('boom'), 'INTERNAL')
    expect(wrapped).toBeInstanceOf(DaMcpError)
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.message).toBe('boom')
  })

  it('passes DaMcpError through unchanged', () => {
    const original = new DaMcpError('NATIVE_FAILED', 'keep')
    const out = toDaMcpError(original, 'OUT_OF_BOUNDS')
    expect(out).toBe(original)
  })

  it('wraps string with fallback code', () => {
    const out = toDaMcpError('bad', 'INVALID_ARGUMENT')
    expect(out.code).toBe('INVALID_ARGUMENT')
    expect(out.message).toBe('bad')
  })

  it('wraps null/undefined with fallback code', () => {
    expect(toDaMcpError(null, 'INTERNAL').code).toBe('INTERNAL')
    expect(toDaMcpError(undefined, 'INTERNAL').code).toBe('INTERNAL')
  })
})

describe('toMcpErrorContent', () => {
  it('returns MCP shape with code prefix', () => {
    const err = new DaMcpError('OUT_OF_BOUNDS', 'too far')
    const result = toMcpErrorContent(err)
    expect(result.isError).toBe(true)
    expect(result.content[0]?.type).toBe('text')
    expect(result.content[0]?.text.startsWith('OUT_OF_BOUNDS: ')).toBe(true)
  })

  it('wraps non-DaMcpError inputs', () => {
    const result = toMcpErrorContent(new Error('boom'))
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text.startsWith('INTERNAL: ')).toBe(true)
  })
})

describe('ERROR_CODE_MESSAGES', () => {
  it('contains every ErrorCode', () => {
    const codes: readonly ErrorCode[] = [
      'OUT_OF_BOUNDS',
      'DISPLAY_NOT_FOUND',
      'NATIVE_MISSING',
      'NATIVE_FAILED',
      'ENOENT',
      'PERMISSION_DENIED',
      'SHELL_INJECTION_DETECTED',
      'INPUT_TOO_LARGE',
      'OCR_FAILED',
      'SCREENSHOT_EMPTY',
      'UNSUPPORTED_PLATFORM',
      'PLATFORM_INIT_FAILED',
      'INVALID_ARGUMENT',
      'INTERNAL',
    ]
    for (const code of codes) {
      expect(ERROR_CODE_MESSAGES[code], `missing message for ${code}`).toBeDefined()
      expect(typeof ERROR_CODE_MESSAGES[code]).toBe('string')
    }
  })
})
