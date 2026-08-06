/**
 * HTTP transport for da-mcp.
 *
 * The MCP SDK handler returned by `createMcpHandler` expects a web
 * `Request` and resolves with a web `Response`. We mount it on Node's
 * `http` server by:
 *
 *   1. validating the first path segment against the bearer token;
 *   2. stripping the token so the handler sees the canonical `/mcp` path;
 *   3. materialising a `Request` from `(req, url, body, headers)`;
 *   4. copying the resulting `Response` back to the `ServerResponse`.
 *
 * Auth failures are signalled with a plain 401 JSON body — they never
 * reach the SDK and never touch the typed `DaMcpError` envelope (mapping
 * to HTTP status codes is the transport's job, not the protocol's).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server'
import { verifyToken } from '../auth/index.js'
import { DaMcpError } from '../errors.js'

export interface HttpServerOptions {
  /** TCP port to bind (use 0 to get a kernel-assigned port, useful in tests). */
  port: number
  /** Host / interface to bind. Defaults to '0.0.0.0' (LAN-reachable, token-gated). */
  host: string
  /** Bearer token required in the first path segment of every request. */
  token: string
  /** Factory that returns a fresh McpServer instance per HTTP request. */
  createServer: () => McpServer
}

export interface HttpServerHandle {
  url: string
  close: () => Promise<void>
}

/**
 * Hosts that bind only the local machine. `localhost` is included because
 * Node resolves it to a loopback address on every supported platform; we
 * compare strings rather than doing DNS resolution so the check is fast and
 * offline-safe.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
])

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host)
}

const LOOPBACK_HINT =
  'da-mcp: bound to loopback — remote clients on the LAN cannot reach this. ' +
  'Set DA_MCP_HTTP_HOST=0.0.0.0 (default) to listen on all interfaces.'

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: 'unauthorized' }))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export async function startHttpServer(opts: HttpServerOptions): Promise<HttpServerHandle> {
  const handler = createMcpHandler(() => opts.createServer())
  const server = createServer(async (req, res) => {
    try {
      if (req.url === undefined) {
        unauthorized(res)
        return
      }
      const url = new URL(req.url, `http://${req.headers.host ?? opts.host}`)
      const segments = url.pathname.split('/').filter((s) => s.length > 0)
      const presented = segments[0] ?? ''
      if (!verifyToken(presented, opts.token)) {
        unauthorized(res)
        return
      }
      const rest = segments.slice(1).join('/')
      url.pathname = rest.length > 0 ? `/${rest}` : '/'
      const body = await readBody(req)
      const headers = new Headers()
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
        else headers.append(key, value)
      }
      const method = req.method ?? 'GET'
      const init: RequestInit = { method, headers, duplex: 'half' }
      if (method !== 'GET' && method !== 'HEAD') init.body = body
      const webReq = new Request(url, init)
      const webRes = await handler.fetch(webReq)
      res.statusCode = webRes.status
      webRes.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'content-length') return
        res.setHeader(key, value)
      })
      const resBody = await webRes.arrayBuffer()
      res.end(Buffer.from(resBody))
    } catch (err: unknown) {
      if (!res.headersSent) res.statusCode = 500
      res.end(JSON.stringify({ error: String(err) }))
    }
  })

  return new Promise<HttpServerHandle>((resolve, reject) => {
    const onError = (err: Error): void => {
      if ('code' in err && (err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        reject(new DaMcpError('PLATFORM_INIT_FAILED', `port ${opts.port} already in use`))
      } else {
        reject(err)
      }
    }
    server.once('error', onError)
    server.listen(opts.port, opts.host, () => {
      server.removeListener('error', onError)
      if (isLoopbackHost(opts.host)) {
        process.stderr.write(`${LOOPBACK_HINT} (bound: ${opts.host})\n`)
      }
      const addr = server.address()
      const boundPort = typeof addr === 'object' && addr !== null ? addr.port : opts.port
      const boundHost = typeof addr === 'object' && addr !== null ? addr.address : opts.host
      resolve({
        url: `http://${boundHost}:${boundPort}/${opts.token}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err !== undefined ? rej(err) : res()))
          }),
      })
    })
  })
}
