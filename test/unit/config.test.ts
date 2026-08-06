import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig, initConfig, getConfig, resetConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'

/** Every env var the config loader reads. Used to scrub process.env per-test. */
const ALL_VARS = [
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'DA_MCP_TESSERACT_BIN',
  'DA_MCP_OCR_BACKEND',
  'DA_MCP_LOG',
  'DA_MCP_TEST_MODE',
  'DA_MCP_TESSDATA_DIR',
  'DA_MCP_MAX_TYPE_BYTES',
  'DA_MCP_SUBPROCESS_TIMEOUT_MS',
  'DA_MCP_TRANSPORT',
  'DA_MCP_PORT',
  'DA_MCP_HTTP_HOST',
  'DA_MCP_TOKEN_PATH',
] as const

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  for (const k of ALL_VARS) delete process.env[k]
  resetConfig()
})

afterEach(() => {
  for (const k of ALL_VARS) delete process.env[k]
  Object.assign(process.env, savedEnv)
  resetConfig()
})

/**
 * Assert that `loadConfig(env)` throws a `DaMcpError` with code `INVALID_ARGUMENT`
 * whose message mentions `expectedKey`. Uses the canonical
 * `expect(() => …).toThrow(DaMcpError)` form and captures the thrown reference
 * for code/message assertions.
 */
function assertInvalidArgument(env: NodeJS.ProcessEnv, expectedKey: string): void {
  let caught: unknown = undefined
  expect(() => {
    try {
      loadConfig(env)
    } catch (e) {
      caught = e
      throw e
    }
  }).toThrow(DaMcpError)
  expect(DaMcpError.is(caught)).toBe(true)
  if (DaMcpError.is(caught)) {
    expect(caught.code).toBe('INVALID_ARGUMENT')
    expect(caught.message).toContain(expectedKey)
  }
}

describe('loadConfig — defaults', () => {
  it('empty env yields all-default Config', () => {
    const cfg = loadConfig({})
    expect(cfg.display).toBeNull()
    expect(cfg.waylandDisplay).toBeNull()
    expect(cfg.tesseractBin).toBe('tesseract')
    expect(cfg.ocrBackend).toBe('cli')
    expect(cfg.logLevel).toBe('info')
    expect(cfg.testMode).toBe('real')
    expect(cfg.tessdataDir).toBe('./tessdata')
    expect(cfg.maxTypeBytes).toBe(65536)
    expect(cfg.subprocessTimeoutMs).toBe(30000)
    expect(cfg.transport).toBe('stdio')
    expect(cfg.httpPort).toBe(3000)
    expect(cfg.httpHost).toBe('0.0.0.0')
    expect(cfg.tokenPath).toBe('')
  })
})

describe('loadConfig — per-env-var', () => {
  it('DISPLAY sets display', () => {
    const cfg = loadConfig({ DISPLAY: ':1' })
    expect(cfg.display).toBe(':1')
    expect(cfg.waylandDisplay).toBeNull()
  })

  it('WAYLAND_DISPLAY sets waylandDisplay', () => {
    const cfg = loadConfig({ WAYLAND_DISPLAY: 'wayland-1' })
    expect(cfg.waylandDisplay).toBe('wayland-1')
    expect(cfg.display).toBeNull()
  })

  it('DA_MCP_TESSERACT_BIN sets tesseractBin', () => {
    const cfg = loadConfig({ DA_MCP_TESSERACT_BIN: '/opt/tess/tesseract' })
    expect(cfg.tesseractBin).toBe('/opt/tess/tesseract')
  })

  it('DA_MCP_OCR_BACKEND=cli sets ocrBackend=cli', () => {
    const cfg = loadConfig({ DA_MCP_OCR_BACKEND: 'cli' })
    expect(cfg.ocrBackend).toBe('cli')
  })

  it('DA_MCP_OCR_BACKEND=wasm sets ocrBackend=wasm', () => {
    const cfg = loadConfig({ DA_MCP_OCR_BACKEND: 'wasm' })
    expect(cfg.ocrBackend).toBe('wasm')
  })

  it('DA_MCP_OCR_BACKEND is case-insensitive (WASM → wasm)', () => {
    const cfg = loadConfig({ DA_MCP_OCR_BACKEND: 'WASM' })
    expect(cfg.ocrBackend).toBe('wasm')
  })

  it('DA_MCP_LOG=debug sets logLevel=debug', () => {
    const cfg = loadConfig({ DA_MCP_LOG: 'debug' })
    expect(cfg.logLevel).toBe('debug')
  })

  it('DA_MCP_TEST_MODE=mock sets testMode=mock', () => {
    const cfg = loadConfig({ DA_MCP_TEST_MODE: 'mock' })
    expect(cfg.testMode).toBe('mock')
  })

  it('DA_MCP_TESSDATA_DIR sets tessdataDir', () => {
    const cfg = loadConfig({ DA_MCP_TESSDATA_DIR: '/var/tessdata' })
    expect(cfg.tessdataDir).toBe('/var/tessdata')
  })

  it('DA_MCP_MAX_TYPE_BYTES=1024 sets maxTypeBytes=1024', () => {
    const cfg = loadConfig({ DA_MCP_MAX_TYPE_BYTES: '1024' })
    expect(cfg.maxTypeBytes).toBe(1024)
  })

  it('DA_MCP_SUBPROCESS_TIMEOUT_MS=5000 sets subprocessTimeoutMs=5000', () => {
    const cfg = loadConfig({ DA_MCP_SUBPROCESS_TIMEOUT_MS: '5000' })
    expect(cfg.subprocessTimeoutMs).toBe(5000)
  })

  it('DA_MCP_TRANSPORT=http sets transport=http', () => {
    const cfg = loadConfig({ DA_MCP_TRANSPORT: 'http' })
    expect(cfg.transport).toBe('http')
  })

  it('DA_MCP_TRANSPORT is case-insensitive (HTTP → http)', () => {
    const cfg = loadConfig({ DA_MCP_TRANSPORT: 'HTTP' })
    expect(cfg.transport).toBe('http')
  })

  it('DA_MCP_PORT=8080 sets httpPort=8080', () => {
    const cfg = loadConfig({ DA_MCP_PORT: '8080' })
    expect(cfg.httpPort).toBe(8080)
  })

  it('DA_MCP_HTTP_HOST sets httpHost', () => {
    const cfg = loadConfig({ DA_MCP_HTTP_HOST: '0.0.0.0' })
    expect(cfg.httpHost).toBe('0.0.0.0')
  })

  it('DA_MCP_HTTP_HOST accepts IPv6 in brackets', () => {
    const cfg = loadConfig({ DA_MCP_HTTP_HOST: '[::1]' })
    expect(cfg.httpHost).toBe('[::1]')
  })

  it('DA_MCP_TOKEN_PATH sets tokenPath', () => {
    const cfg = loadConfig({ DA_MCP_TOKEN_PATH: '/etc/da-mcp.token' })
    expect(cfg.tokenPath).toBe('/etc/da-mcp.token')
  })

  it('empty string is treated as unset (DA_MCP_LOG)', () => {
    const cfg = loadConfig({ DA_MCP_LOG: '' })
    expect(cfg.logLevel).toBe('info')
  })

  it('empty string is treated as unset (DA_MCP_MAX_TYPE_BYTES)', () => {
    const cfg = loadConfig({ DA_MCP_MAX_TYPE_BYTES: '' })
    expect(cfg.maxTypeBytes).toBe(65536)
  })
})

describe('loadConfig — invalid enum values', () => {
  it('DA_MCP_LOG=invalid throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_LOG: 'verbose' }, 'DA_MCP_LOG')
  })

  it('DA_MCP_OCR_BACKEND=invalid throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_OCR_BACKEND: 'junk' }, 'DA_MCP_OCR_BACKEND')
  })

  it('DA_MCP_TEST_MODE=invalid throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_TEST_MODE: 'fake' }, 'DA_MCP_TEST_MODE')
  })

  it('DA_MCP_TRANSPORT=invalid throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_TRANSPORT: 'tcp' }, 'DA_MCP_TRANSPORT')
  })

  it('DA_MCP_HTTP_HOST with spaces throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_HTTP_HOST: 'bad host' }, 'DA_MCP_HTTP_HOST')
  })

  it('DA_MCP_HTTP_HOST with shell metachar throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_HTTP_HOST: 'a;b' }, 'DA_MCP_HTTP_HOST')
  })
})

describe('loadConfig — invalid numeric values', () => {
  it('DA_MCP_MAX_TYPE_BYTES=0 throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_MAX_TYPE_BYTES: '0' }, 'DA_MCP_MAX_TYPE_BYTES')
  })

  it('DA_MCP_MAX_TYPE_BYTES=-1 throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_MAX_TYPE_BYTES: '-1' }, 'DA_MCP_MAX_TYPE_BYTES')
  })

  it('DA_MCP_MAX_TYPE_BYTES=abc throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_MAX_TYPE_BYTES: 'abc' }, 'DA_MCP_MAX_TYPE_BYTES')
  })

  it('DA_MCP_SUBPROCESS_TIMEOUT_MS=0 throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_SUBPROCESS_TIMEOUT_MS: '0' }, 'DA_MCP_SUBPROCESS_TIMEOUT_MS')
  })

  it('DA_MCP_SUBPROCESS_TIMEOUT_MS=NaN throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_SUBPROCESS_TIMEOUT_MS: 'NaN' }, 'DA_MCP_SUBPROCESS_TIMEOUT_MS')
  })

  it('DA_MCP_PORT=0 throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_PORT: '0' }, 'DA_MCP_PORT')
  })

  it('DA_MCP_PORT=-1 throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_PORT: '-1' }, 'DA_MCP_PORT')
  })

  it('DA_MCP_PORT=abc throws INVALID_ARGUMENT', () => {
    assertInvalidArgument({ DA_MCP_PORT: 'abc' }, 'DA_MCP_PORT')
  })
})

describe('singleton lifecycle', () => {
  it('getConfig() throws DaMcpError(INTERNAL) when initConfig() was not called', () => {
    let caught: unknown = undefined
    try {
      getConfig()
    } catch (e) {
      caught = e
    }
    expect(DaMcpError.is(caught)).toBe(true)
    if (DaMcpError.is(caught)) {
      expect(caught.code).toBe('INTERNAL')
    }
  })

  it('initConfig() + getConfig() returns the same singleton', () => {
    const a = initConfig({ DA_MCP_LOG: 'debug' })
    const b = getConfig()
    expect(a).toBe(b)
    expect(b.logLevel).toBe('debug')
  })

  it('resetConfig() then getConfig() throws again', () => {
    initConfig({})
    resetConfig()
    expect(() => getConfig()).toThrow(DaMcpError)
  })

  it('initConfig() is idempotent — second call reloads with new env', () => {
    initConfig({ DA_MCP_LOG: 'trace' })
    const second = initConfig({ DA_MCP_LOG: 'error' })
    expect(getConfig()).toBe(second)
    expect(getConfig().logLevel).toBe('error')
  })
})