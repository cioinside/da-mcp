import { describe, it, expect, afterEach } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { startHttpServer } from '../../src/transport/http.js'
import { DaMcpError } from '../../src/errors.js'

const TOKEN = 'integration-test-token-abcdef1234567890123456789012'

const MCP_POST_HEADERS = {
  'content-type': 'application/json',
  'accept': 'application/json, text/event-stream',
} as const

const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '0.0.0' },
  },
})

function createEchoServer(): McpServer {
  const server = new McpServer(
    { name: 'echo-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  )
  server.registerTool(
    'echo',
    {
      description: 'echo',
      inputSchema: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (v: unknown) => ({ value: v }),
        },
        '~standard-version': 1,
      },
    },
    async (args: unknown) => {
      const text = JSON.stringify(args)
      const result: CallToolResult = {
        content: [{ type: 'text', text }],
      }
      return result
    },
  )
  return server
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as AddressInfo
      const port = addr.port
      s.close((err) => (err !== undefined ? reject(err) : resolve(port)))
    })
  })
}

const handles: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  while (handles.length > 0) {
    const h = handles.pop()
    if (h !== undefined) await h.close()
  }
})

describe('startHttpServer', () => {
  it('serves a valid initialize request with the correct token in path', async () => {
    const port = await freePort()
    const handle = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    handles.push(handle)
    const res = await fetch(`${handle.url}/mcp`, {
      method: 'POST',
      headers: MCP_POST_HEADERS,
      body: INITIALIZE_REQUEST,
    })
    expect(res.status).toBe(200)
    expect(handle.url).toContain(`/${TOKEN}`)
  })

  it('returns 401 when token path segment is missing', async () => {
    const port = await freePort()
    const handle = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    handles.push(handle)
    const url = handle.url.replace(`/${TOKEN}`, '')
    const res = await fetch(`${url}/mcp`)
    expect(res.status).toBe(401)
  })

  it('returns 401 when token path segment is wrong', async () => {
    const port = await freePort()
    const handle = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    handles.push(handle)
    const url = handle.url.replace(TOKEN, 'wrong-token-value')
    const res = await fetch(`${url}/mcp`)
    expect(res.status).toBe(401)
  })

  it('handles POST requests with a body', async () => {
    const port = await freePort()
    const handle = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    handles.push(handle)
    const res = await fetch(`${handle.url}/mcp`, {
      method: 'POST',
      headers: MCP_POST_HEADERS,
      body: INITIALIZE_REQUEST,
    })
    expect(res.status).toBe(200)
  })

  it('close() resolves without error', async () => {
    const port = await freePort()
    const handle = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    await expect(handle.close()).resolves.toBeUndefined()
  })

  it('throws DaMcpError(PLATFORM_INIT_FAILED) on port already in use', async () => {
    const port = await freePort()
    const blocker = await startHttpServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      createServer: createEchoServer,
    })
    handles.push(blocker)
    let caught: unknown = undefined
    try {
      await startHttpServer({
        port,
        host: '127.0.0.1',
        token: TOKEN,
        createServer: createEchoServer,
      })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DaMcpError)
    if (caught instanceof DaMcpError) {
      expect(caught.code).toBe('PLATFORM_INIT_FAILED')
    }
  })
})

void InMemoryTransport