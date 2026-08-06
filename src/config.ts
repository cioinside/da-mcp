/**
 * Environment-driven configuration.
 *
 * This is the ONLY module that reads process.env directly. All other code
 * must consume the singleton returned by getConfig() (or pass an env object
 * to loadConfig() in tests).
 */

import type { LogLevel } from './log.js'
import { DaMcpError } from './errors.js'

export interface Config {
  /** X11 display (e.g. ':0', 'localhost:12.0') or null. */
  display: string | null
  /** Wayland display socket (e.g. 'wayland-0') or null. */
  waylandDisplay: string | null
  /** Path to tesseract binary. Defaults to 'tesseract' (resolved via PATH). */
  tesseractBin: string
  /** OCR backend override. 'cli' (default) | 'wasm' (tesseract.js in-process). */
  ocrBackend: 'cli' | 'wasm'
  /** Log level. Default: 'info'. */
  logLevel: LogLevel
  /** When 'mock', all modules skip real native calls (used by tests). */
  testMode: 'real' | 'mock'
  /** Directory where Tesseract will cache traineddata if wasm backend is used. */
  tessdataDir: string
  /** Maximum bytes for da_type input (defense against huge payloads). */
  maxTypeBytes: number
  /** Maximum milliseconds to wait for a native subprocess before killing it. */
  subprocessTimeoutMs: number
  /** Transport to bind. 'stdio' (default) | 'http'. */
  transport: 'stdio' | 'http'
  /** TCP port for HTTP transport. Default: 3000. */
  httpPort: number
  /** Host / interface for HTTP transport. Default: '127.0.0.1' (loopback only). */
  httpHost: string
  /** Override path for the auth token file. Empty = resolve at runtime. */
  tokenPath: string
}

const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error']
const OCR_BACKENDS: readonly ('cli' | 'wasm')[] = ['cli', 'wasm']
const TEST_MODES: readonly ('real' | 'mock')[] = ['real', 'mock']
const TRANSPORTS: readonly ('stdio' | 'http')[] = ['stdio', 'http']
const HOST_PATTERN = /^[a-zA-Z0-9.\-:\[\]]+$/

function readNonEmpty(env: NodeJS.ProcessEnv, key: string): string | null {
  const v = env[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length === 0) return null
  return v
}

function pickEnum<T extends string>(
  raw: string,
  allowed: readonly T[],
  envKey: string,
): T {
  const lower = raw.toLowerCase()
  for (const candidate of allowed) {
    if (candidate === lower) return candidate
  }
  const list = allowed.join(',')
  throw new DaMcpError(
    'INVALID_ARGUMENT',
    `${envKey}: invalid value "${raw}", expected one of ${list}`,
  )
}

function pickPositiveInt(raw: string, envKey: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `${envKey}: invalid value "${raw}", expected a positive integer`,
    )
  }
  return n
}

/** Load configuration from an env-shaped object. Pure: function of `env`. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const display = readNonEmpty(env, 'DISPLAY')
  const waylandDisplay = readNonEmpty(env, 'WAYLAND_DISPLAY')

  const tesseractBinRaw = env['DA_MCP_TESSERACT_BIN']
  const tesseractBin =
    tesseractBinRaw !== undefined && tesseractBinRaw.length > 0
      ? tesseractBinRaw
      : 'tesseract'

  const ocrBackendRaw = env['DA_MCP_OCR_BACKEND']
  const ocrBackend =
    ocrBackendRaw !== undefined && ocrBackendRaw.length > 0
      ? pickEnum(ocrBackendRaw, OCR_BACKENDS, 'DA_MCP_OCR_BACKEND')
      : 'cli'

  const logLevelRaw = env['DA_MCP_LOG']
  const logLevel =
    logLevelRaw !== undefined && logLevelRaw.length > 0
      ? pickEnum(logLevelRaw, LOG_LEVELS, 'DA_MCP_LOG')
      : 'info'

  const testModeRaw = env['DA_MCP_TEST_MODE']
  const testMode =
    testModeRaw !== undefined && testModeRaw.length > 0
      ? pickEnum(testModeRaw, TEST_MODES, 'DA_MCP_TEST_MODE')
      : 'real'

  const tessdataDirRaw = env['DA_MCP_TESSDATA_DIR']
  const tessdataDir =
    tessdataDirRaw !== undefined && tessdataDirRaw.length > 0 ? tessdataDirRaw : './tessdata'

  const maxTypeBytesRaw = env['DA_MCP_MAX_TYPE_BYTES']
  const maxTypeBytes =
    maxTypeBytesRaw !== undefined && maxTypeBytesRaw.length > 0
      ? pickPositiveInt(maxTypeBytesRaw, 'DA_MCP_MAX_TYPE_BYTES')
      : 65536

  const subprocessTimeoutRaw = env['DA_MCP_SUBPROCESS_TIMEOUT_MS']
  const subprocessTimeoutMs =
    subprocessTimeoutRaw !== undefined && subprocessTimeoutRaw.length > 0
      ? pickPositiveInt(subprocessTimeoutRaw, 'DA_MCP_SUBPROCESS_TIMEOUT_MS')
      : 30000

  const transportRaw = env['DA_MCP_TRANSPORT']
  const transport =
    transportRaw !== undefined && transportRaw.length > 0
      ? pickEnum(transportRaw, TRANSPORTS, 'DA_MCP_TRANSPORT')
      : 'stdio'

  const httpPortRaw = env['DA_MCP_PORT']
  const httpPort =
    httpPortRaw !== undefined && httpPortRaw.length > 0
      ? pickPositiveInt(httpPortRaw, 'DA_MCP_PORT')
      : 3000

  const httpHostRaw = env['DA_MCP_HTTP_HOST']
  const httpHost =
    httpHostRaw !== undefined && httpHostRaw.length > 0 ? httpHostRaw : '0.0.0.0'
  if (!HOST_PATTERN.test(httpHost)) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      `DA_MCP_HTTP_HOST: invalid value "${httpHost}", expected alphanumeric, dots, dashes, colons, or brackets`,
    )
  }

  const tokenPathRaw = env['DA_MCP_TOKEN_PATH']
  const tokenPath =
    tokenPathRaw !== undefined && tokenPathRaw.length > 0 ? tokenPathRaw : ''

  return {
    display,
    waylandDisplay,
    tesseractBin,
    ocrBackend,
    logLevel,
    testMode,
    tessdataDir,
    maxTypeBytes,
    subprocessTimeoutMs,
    transport,
    httpPort,
    httpHost,
    tokenPath,
  }
}

let _config: Config | null = null

/**
 * Initialize the module-local singleton config from process.env.
 * Idempotent: subsequent calls reload and overwrite.
 */
export function initConfig(env: NodeJS.ProcessEnv = process.env): Config {
  _config = loadConfig(env)
  return _config
}

/** Get the singleton. Throws DaMcpError('INTERNAL') if initConfig was not called. */
export function getConfig(): Config {
  if (_config === null) {
    throw new DaMcpError(
      'INTERNAL',
      'config not initialized: call initConfig() at server startup',
    )
  }
  return _config
}

/** Reset the singleton (for tests). */
export function resetConfig(): void {
  _config = null
}
