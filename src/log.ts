/**
 * Structured JSON-line logger. Writes one JSON object per line to a Writable
 * stream. Defaults to process.stderr (stdout is reserved for MCP JSON-RPC).
 * Level filtering is numeric; circular context values become '[unserializable]'.
 */
import { getConfig } from './config.js'

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 }
const UNSERIALIZABLE = '[unserializable]'

export interface LogContext { [key: string]: unknown }
export interface LogFields { component?: string; tool?: string; context?: LogContext }
export interface Logger {
  trace(msg: string, fields?: LogFields): void
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  child(component: string): Logger
  setLevel(level: LogLevel): void
}
export interface CreateLoggerOptions {
  stream?: NodeJS.WritableStream
  level?: LogLevel
  name?: string
}

/** JSON.stringify that replaces circular refs and BigInt/function/symbol with '[unserializable]'. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  const replacer = (_k: string, raw: unknown): unknown => {
    if (raw === null || raw === undefined) return raw
    const t = typeof raw
    if (t === 'string' || t === 'number' || t === 'boolean') return raw
    if (t === 'bigint' || t === 'function' || t === 'symbol') return UNSERIALIZABLE
    if (raw instanceof Error) return { name: raw.name, message: raw.message, stack: raw.stack }
    if (typeof raw === 'object') {
      if (seen.has(raw)) return UNSERIALIZABLE
      seen.add(raw)
      return raw
    }
    return UNSERIALIZABLE
  }
  try { return JSON.stringify(value, replacer) } catch { return JSON.stringify(UNSERIALIZABLE) }
}

interface LoggerState {
  level: LogLevel
  threshold: number
  stream: NodeJS.WritableStream
  name: string
  component: string | undefined
}

function buildLogger(state: LoggerState): Logger {
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    if (LOG_LEVELS[level] < state.threshold) return
    const record: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      logger: state.name,
      msg,
    }
    const component = fields?.component ?? state.component
    if (component !== undefined) record.component = component
    if (fields?.tool !== undefined) record.tool = fields.tool
    if (fields?.context !== undefined) record.context = fields.context
    state.stream.write(safeStringify(record) + '\n')
  }
  return {
    trace: (m, f) => emit('trace', m, f),
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (component) =>
      buildLogger({
        level: state.level,
        threshold: state.threshold,
        stream: state.stream,
        name: state.name,
        component: state.component !== undefined ? `${state.component}:${component}` : component,
      }),
    setLevel: (level) => {
      state.level = level
      state.threshold = LOG_LEVELS[level]
    },
  }
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const level = opts.level ?? 'info'
  return buildLogger({
    level,
    threshold: LOG_LEVELS[level],
    stream: opts.stream ?? process.stderr,
    name: opts.name ?? 'da-mcp',
    component: undefined,
  })
}

let _defaultLogger: Logger | null = null

/** Returns the module-local default logger; initializes lazily from getConfig().logLevel. */
export function getLogger(): Logger {
  if (_defaultLogger !== null) return _defaultLogger
  _defaultLogger = createLogger({ level: getConfig().logLevel })
  return _defaultLogger
}

/** Test helper: reset the default logger singleton. */
export function resetDefaultLogger(): void {
  _defaultLogger = null
}