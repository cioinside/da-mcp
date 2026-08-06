/**
 * MCP server entrypoint for da-mcp.
 *
 * Registers the 12 da_* tools with the @modelcontextprotocol/server SDK and
 * serves them over stdio. Owns config bootstrap, stderr logging, and graceful
 * SIGINT/SIGTERM shutdown. Run via `node dist/server-dispatch.js` or `npm start`.
 */
import {
  McpServer,
  InMemoryTransport,
  type CallToolResult,
  type ServerContext,
  type StandardSchemaWithJSON,
  type ToolCallback,
} from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import type { ZodType } from 'zod'
import { ALL_TOOLS } from './tools/index.js'
import { SERVER_NAME, SERVER_VERSION, PROTOCOL_VERSION } from './version.js'
import { SERVER_INSTRUCTIONS } from './server-instructions.js'
import { DaMcpError, toDaMcpError, type ErrorCode } from './errors.js'
import { initConfig, getConfig } from './config.js'
import { getLogger } from './log.js'

interface ErrorEnvelope {
  code: ErrorCode
  message: string
  cause?: string
}

/**
 * Recursively walk `value`, replacing every `Buffer` with a plain `number[]`.
 * Buffers survive `JSON.stringify` as `{type:"Buffer",data:[…]}`, which has
 * neither a `.length` property nor an index signature, so we normalize up
 * front before handing the value to the SDK as `structuredContent`. The e2e
 * contract (`sc.buffer[0] === 0x89 && sc.buffer.length === 8`) depends on this
 * indexed-access shape.
 */
function bufferToBytes(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    const out: number[] = new Array(value.length)
    for (let i = 0; i < value.length; i++) out[i] = value[i]!
    return out
  }
  if (Array.isArray(value)) {
    return value.map((v) => bufferToBytes(v))
  }
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src)) {
      out[key] = bufferToBytes(src[key])
    }
    return out
  }
  return value
}

/**
 * Wrap a tool handler so its result becomes an MCP CallToolResult and any
 * thrown DaMcpError becomes a structured error envelope on both `content`
 * (text form) and `structuredContent` (machine-readable form).
 */
export async function wrapHandlerResult(
  handler: (input: unknown) => Promise<unknown>,
  args: unknown,
): Promise<CallToolResult> {
  try {
    const result = await handler(args)
    const structured = bufferToBytes(result) as Record<string, unknown>
    return {
      content: [{ type: 'text', text: JSON.stringify(result, undefined, 2) }],
      structuredContent: structured,
    }
  } catch (value: unknown) {
    const err = toDaMcpError(value)
    const envelope: ErrorEnvelope = { code: err.code, message: err.message }
    if (err.cause instanceof Error) envelope.cause = err.cause.message
    else if (typeof err.cause === 'string') envelope.cause = err.cause
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(envelope) }],
      structuredContent: { error: envelope },
    }
  }
}

/**
 * Type-safe boundary from a Zod schema to the SDK's `StandardSchemaWithJSON`
 * nominal type. Mirrors the SDK's runtime predicate (`"~standard" in schema
 * && typeof schema["~standard"]?.validate === "function"`): a non-conforming
 * value throws a typed `DaMcpError('INVALID_ARGUMENT')` instead of silently
 * blowing up later inside `validateToolInput`.
 */
function asStandardSchema<S extends ZodType>(schema: S): StandardSchemaWithJSON {
  const probe = schema as unknown as {
    '~standard'?: { validate?: unknown }
  }
  if (typeof probe['~standard']?.validate !== 'function') {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'tool inputSchema is not a Standard Schema',
    )
  }
  return schema as unknown as StandardSchemaWithJSON
}

/**
 * Build a fresh McpServer with all da_* tools registered and tools capability
 * advertised. The caller owns lifecycle (connect / close).
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  )
  for (const tool of ALL_TOOLS) {
    const inputSchema = asStandardSchema(tool.inputSchema)
    const cb: ToolCallback<StandardSchemaWithJSON> = async (
      args: unknown,
      _ctx: ServerContext,
    ) => wrapHandlerResult(tool.handler, args)
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema },
      cb,
    )
  }
  return server
}

function installShutdown(server: McpServer): {
  closed: Promise<void>
  trigger: (signal: NodeJS.Signals) => void
} {
  let resolveClosed: (() => void) | null = null
  let rejectClosed: ((err: unknown) => void) | null = null
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve
    rejectClosed = reject
  })
  const trigger = (signal: NodeJS.Signals): void => {
    getLogger().info('da-mcp shutdown signal received', { context: { signal } })
    server
      .close()
      .then(() => {
        if (resolveClosed !== null) resolveClosed()
        process.exit(0)
      })
      .catch((err: unknown) => {
        if (rejectClosed !== null) rejectClosed(err)
        process.exit(1)
      })
  }
  process.once('SIGINT', trigger)
  process.once('SIGTERM', trigger)
  return { closed, trigger }
}

/**
 * Boot over stdio, install signal handlers, resolve on close / reject on
 * connect failure.
 */
export function runServer(): Promise<void> {
  try {
    getConfig()
  } catch (err) {
    if (err instanceof DaMcpError && err.code === 'INTERNAL') {
      initConfig()
    } else {
      throw err
    }
  }
  const server = createMcpServer()
  const { closed } = installShutdown(server)
  const transport = new StdioServerTransport()
  getLogger().info('da-mcp server started', {
    component: 'server',
    context: { transport: 'stdio', protocol: PROTOCOL_VERSION },
  })
  return server
    .connect(transport)
    .catch((err: unknown) => {
      getLogger().error('da-mcp server connect failed', {
        context: { err: String(err) },
      })
      throw err
    })
    .then(() => closed)
}

/**
 * Boot over HTTP with token-in-path auth; resolves on SIGINT/SIGTERM close.
 */
export function runHttpServer(): Promise<void> {
  const cfg = (() => {
    try {
      return getConfig()
    } catch {
      return initConfig()
    }
  })()
  return import('./transport/index.js')
    .then(async ({ startHttpServer }) => {
      const { loadOrCreateToken } = await import('./auth/index.js')
      const token = await loadOrCreateToken(
        cfg.tokenPath.length > 0 ? cfg.tokenPath : undefined,
      )
      const handle = await startHttpServer({
        port: cfg.httpPort,
        host: cfg.httpHost,
        token,
        createServer: createMcpServer,
      })
      getLogger().info('da-mcp http server started', {
        component: 'server',
        context: {
          transport: 'http',
          url: handle.url,
          protocol: PROTOCOL_VERSION,
        },
      })
      return new Promise<void>((resolve) => {
        const shutdown = (signal: NodeJS.Signals): void => {
          getLogger().info('da-mcp http shutdown signal received', {
            component: 'server',
            context: { signal },
          })
          handle.close().then(resolve, (err: unknown) => {
            getLogger().error('da-mcp http server close failed', {
              context: { err: String(err) },
            })
            resolve()
          })
        }
        process.once('SIGINT', shutdown)
        process.once('SIGTERM', shutdown)
      })
    })
}

/**
 * CLI subcommand `token regenerate` (or `generate`); prints the full URL.
 */
export async function runTokenRegenerate(): Promise<void> {
  const cfg = (() => {
    try {
      return getConfig()
    } catch {
      return initConfig()
    }
  })()
  const { regenerateToken, getServerUrl } = await import('./auth/index.js')
  const token = await regenerateToken(
    cfg.tokenPath.length > 0 ? cfg.tokenPath : undefined,
  )
  // CLI surface — stdout, not stderr.
  process.stdout.write(`${getServerUrl(token, cfg.httpHost, cfg.httpPort)}\n`)
}

// Re-export of InMemoryTransport prevents dead-code elimination for test
// scripts that import it from this module. CLI dispatch lives in
// server-dispatch.ts to keep this file under the 250 LOC ceiling.
export { InMemoryTransport }
