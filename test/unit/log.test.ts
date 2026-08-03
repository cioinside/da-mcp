import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Writable } from 'node:stream'
import { createLogger, getLogger, resetDefaultLogger } from '../../src/log.js'
import { initConfig, resetConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'

interface Capture {
  stream: Writable
  lines: string[]
}

function makeCapture(): Capture {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
      lines.push(typeof chunk === 'string' ? chunk : chunk.toString())
      cb()
    },
  })
  return { stream, lines }
}

const parse = (line: string): Record<string, unknown> =>
  JSON.parse(line.trim()) as Record<string, unknown>

describe('createLogger', () => {
  let cap: Capture
  beforeEach(() => {
    cap = makeCapture()
  })
  it('emits one JSON line per call with ts, level, logger, msg fields', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info', name: 'svc' })
    logger.info('hello')
    expect(cap.lines.length).toBe(1)
    const r = parse(cap.lines[0]!)
    expect(typeof r['ts']).toBe('string')
    expect(Number.isNaN(Date.parse(r['ts'] as string))).toBe(false)
    expect(r['level']).toBe('info')
    expect(r['logger']).toBe('svc')
    expect(r['msg']).toBe('hello')
  })

  it('defaults: level=info, name=da-mcp; trace and debug are filtered', () => {
    const logger = createLogger({ stream: cap.stream })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    expect(cap.lines.length).toBe(1)
    const r = parse(cap.lines[0]!)
    expect(r['logger']).toBe('da-mcp')
    expect(r['level']).toBe('info')
    expect(r['msg']).toBe('i')
  })

  it('info level emits info, warn, error (skips trace, debug)', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.trace('t')
    logger.debug('d')
    logger.info('i')
    logger.warn('w')
    logger.error('e')
    expect(cap.lines.map((l) => parse(l)['level'])).toEqual(['info', 'warn', 'error'])
  })

  it('custom level warn filters out info and below', () => {
    const logger = createLogger({ stream: cap.stream, level: 'warn' })
    logger.info('x')
    logger.debug('y')
    logger.warn('z')
    logger.error('a')
    expect(cap.lines.map((l) => parse(l)['msg'])).toEqual(['z', 'a'])
  })

  it('setLevel mutates filter at runtime', () => {
    const logger = createLogger({ stream: cap.stream, level: 'warn' })
    logger.error('a')
    logger.setLevel('debug')
    logger.debug('b')
    logger.setLevel('error')
    logger.warn('c')
    expect(cap.lines.map((l) => parse(l)['msg'])).toEqual(['a', 'b'])
  })
})
describe('child()', () => {
  let cap: Capture
  beforeEach(() => {
    cap = makeCapture()
  })

  it('adds component field to the record', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.child('foo').info('bar')
    expect(parse(cap.lines[0]!)['component']).toBe('foo')
  })

  it('nested child concatenates component names with colon', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.child('a').child('b').info('x')
    expect(parse(cap.lines[0]!)['component']).toBe('a:b')
  })

  it('child inherits parent stream', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.child('c').info('ch')
    logger.info('p')
    expect(cap.lines.length).toBe(2)
    expect(cap.lines.map((l) => parse(l)['msg'])).toEqual(['ch', 'p'])
  })

  it('child setLevel does NOT affect parent', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    const child = logger.child('c')
    child.setLevel('trace')
    child.trace('from-child')
    logger.trace('from-parent')
    expect(cap.lines.length).toBe(1)
    expect(parse(cap.lines[0]!)['msg']).toBe('from-child')
  })

  it('child setLevel works independently for itself', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    const child = logger.child('c')
    child.setLevel('debug')
    child.debug('ok')
    expect(cap.lines.length).toBe(1)
    expect(parse(cap.lines[0]!)['level']).toBe('debug')
  })
})
describe('LogFields', () => {
  let cap: Capture
  beforeEach(() => {
    cap = makeCapture()
  })

  it('includes tool field when set', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('x', { tool: 'da_screenshot' })
    expect(parse(cap.lines[0]!)['tool']).toBe('da_screenshot')
  })

  it('includes context field when set', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('x', { context: { foo: 'bar', n: 42 } })
    expect(parse(cap.lines[0]!)['context']).toEqual({ foo: 'bar', n: 42 })
  })

  it('omits tool and context when not set', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('x')
    const r = parse(cap.lines[0]!)
    expect('tool' in r).toBe(false)
    expect('context' in r).toBe(false)
  })
})
describe('safeStringify edge cases', () => {
  let cap: Capture
  beforeEach(() => {
    cap = makeCapture()
  })

  it('circular reference in context becomes [unserializable]', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    logger.info('x', { context: { cyclic } })
    const r = parse(cap.lines[0]!) as { context: { cyclic: { self: string } } }
    expect(r.context.cyclic.self).toBe('[unserializable]')
  })

  it('BigInt in context becomes [unserializable]', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('x', { context: { big: BigInt(123) } })
    const r = parse(cap.lines[0]!) as { context: { big: string } }
    expect(r.context.big).toBe('[unserializable]')
  })

  it('Error in context is unwrapped to {name, message, stack}', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('x', { context: { err: new Error('boom') } })
    const r = parse(cap.lines[0]!) as {
      context: { err: { name: string; message: string; stack: string } }
    }
    expect(r.context.err.name).toBe('Error')
    expect(r.context.err.message).toBe('boom')
    expect(typeof r.context.err.stack).toBe('string')
  })

  it('preserves empty msg and special chars in msg', () => {
    const logger = createLogger({ stream: cap.stream, level: 'info' })
    logger.info('')
    logger.info('a"b\\c\nd')
    expect(parse(cap.lines[0]!)['msg']).toBe('')
    expect(parse(cap.lines[1]!)['msg']).toBe('a"b\\c\nd')
  })
})

describe('getLogger', () => {
  beforeEach(() => {
    resetConfig()
    resetDefaultLogger()
  })
  afterEach(() => {
    resetDefaultLogger()
    resetConfig()
  })

  it('throws DaMcpError INTERNAL if initConfig has not been called', () => {
    resetDefaultLogger()
    resetConfig()
    let caught: unknown
    try {
      getLogger()
    } catch (e) {
      caught = e
    }
    expect(DaMcpError.is(caught)).toBe(true)
    expect((caught as DaMcpError).code).toBe('INTERNAL')
  })

  it('returns a logger whose level matches cfg.logLevel from initConfig', () => {
    initConfig({ DA_MCP_LOG: 'debug' })
    resetDefaultLogger()
    const logger = getLogger()
    const captured: string[] = []
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(
      ((chunk: string | Uint8Array): boolean => {
        captured.push(typeof chunk === 'string' ? chunk : chunk.toString())
        return true
      }) as unknown as typeof process.stderr.write,
    )
    try {
      logger.debug('hello')
      logger.trace('skipped')
    } finally {
      spy.mockRestore()
    }
    expect(captured.length).toBe(1)
    const r = parse(captured[0]!) as { msg: string; level: string }
    expect(r.msg).toBe('hello')
    expect(r.level).toBe('debug')
  })

  it('resetDefaultLogger clears the singleton (next getLogger returns a new instance)', () => {
    initConfig({ DA_MCP_LOG: 'info' })
    resetDefaultLogger()
    const first = getLogger()
    resetDefaultLogger()
    const second = getLogger()
    expect(first).not.toBe(second)
  })
})