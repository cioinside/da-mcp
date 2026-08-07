// E2E: full MCP wire-protocol lifecycle over InMemoryTransport.
// Drives JSON-RPC 2.0 end-to-end (init → list → call → close).
// Side-effect-free via DA_MCP_TEST_MODE=mock; no native I/O.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { InMemoryTransport, type JSONRPCMessage } from '@modelcontextprotocol/server'
import { initConfig, resetConfig } from '../../src/config.js'
import { createMcpServer } from '../../src/server.js'

type ContentBlock = {
  type: string
  text?: string
  data?: string
  mimeType?: string
}

type R = {
  content?: ContentBlock[]
  isError?: boolean
  structuredContent?: Record<string, unknown>
}

const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'mcp-lifecycle-test', version: '0.0.0' },
}

/** Send one JSON-RPC request and await its matching response. */
function rpc(client: InMemoryTransport, req: JSONRPCMessage): Promise<JSONRPCMessage> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rpc timeout')), 5000)
    const orig = client.onmessage
    client.onmessage = (m: JSONRPCMessage) => {
      clearTimeout(t)
      client.onmessage = orig
      resolve(m)
    }
    client.send(req).catch((e: unknown) => {
      clearTimeout(t)
      client.onmessage = orig
      reject(e)
    })
  })
}

/** Connect a fresh server to a paired client and initialize both. */
async function setupPair(): Promise<{
  client: InMemoryTransport
  server: ReturnType<typeof createMcpServer>
}> {
  const server = createMcpServer()
  const [client, serverT] = InMemoryTransport.createLinkedPair()
  await server.connect(serverT)
  await rpc(client, { jsonrpc: '2.0', id: 0, method: 'initialize', params: INIT })
  return { client, server }
}

function asResult(m: JSONRPCMessage): Record<string, unknown> {
  if ('result' in m && m.result) return m.result as Record<string, unknown>
  throw new Error('expected result, got error response')
}
function asError(m: JSONRPCMessage): { code: number; message: string } {
  if ('error' in m && m.error) return m.error
  throw new Error('expected error, got result')
}

beforeEach(() => {
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})
afterEach(() => {
  resetConfig()
})

describe('mcp wire-protocol lifecycle', () => {
  it('initialize echoes protocolVersion, serverInfo, and tools capability', async () => {
    const { client, server } = await setupPair()
    const r = asResult(
      await rpc(client, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }),
    ) as {
      protocolVersion: string
      capabilities: { tools?: { listChanged?: boolean } }
      serverInfo: { name: string; version: string }
    }
    expect(r.protocolVersion.length).toBeGreaterThan(0)
    expect(r.serverInfo.name).toBe('da-mcp')
    expect(r.serverInfo.version.length).toBeGreaterThan(0)
    expect(r.capabilities.tools?.listChanged).toBe(true)
    await server.close()
  })

  it('initialize returns the server instructions to the client', async () => {
    const { client, server } = await setupPair()
    const r = asResult(
      await rpc(client, { jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT }),
    ) as { instructions?: string }
    expect(typeof r.instructions).toBe('string')
    expect(r.instructions?.length ?? 0).toBeGreaterThan(0)
    expect(r.instructions).toContain('Do NOT write an orchestrator script')
    await server.close()
  })

  it('tools/list returns exactly 20 tools with name/description/inputSchema', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ) as { tools: { name: string; description?: string; inputSchema?: unknown }[] }
    expect(r.tools).toHaveLength(20)
    for (const t of r.tools) {
      expect(typeof t.name).toBe('string')
      expect(typeof t.description).toBe('string')
      expect(t.inputSchema).toBeDefined()
    }
  })

  it('every registered tool name starts with the "da_" prefix', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ) as { tools: { name: string }[] }
    for (const t of r.tools) expect(t.name.startsWith('da_')).toBe(true)
  })

  it('da_screenshot { displayId: null } emits MCP ImageContent for PNG + metadata text', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_screenshot', arguments: { displayId: null } },
      }),
    ) as R
    expect(r.isError).toBeFalsy()
    expect(r.content).toHaveLength(2)

    const image = r.content?.[0]
    expect(image?.type).toBe('image')
    expect(image?.mimeType).toBe('image/png')
    expect(typeof image?.data).toBe('string')
    expect((image?.data ?? '').length).toBeGreaterThan(0)
    const decoded = Buffer.from(image?.data ?? '', 'base64')
    expect(decoded.length).toBe(8)
    expect(decoded[0]).toBe(0x89)

    const text = r.content?.[1]
    expect(text?.type).toBe('text')
    const meta = JSON.parse(text?.text ?? '{}') as { length?: number; buffer?: unknown }
    expect(meta.length).toBe(8)
    expect(meta.buffer).toBeUndefined()

    const sc = r.structuredContent as {
      buffer: { length: number; [n: number]: number }
      length: number
    }
    expect(sc.buffer.length).toBe(8)
    expect(sc.buffer[0]).toBe(0x89)
    expect(sc.length).toBe(8)
  })

  it('da_move_mouse { x: 100, y: 200 } succeeds with echoed coordinates', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_move_mouse', arguments: { x: 100, y: 200 } },
      }),
    ) as R & { structuredContent: { moved: boolean; x: number; y: number } }
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent).toEqual({ moved: true, x: 100, y: 200 })
    expect(r.content?.[0]?.text).toContain('moved')
  })

  it('da_move_mouse { x: -1 } is rejected with isError validation envelope', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_move_mouse', arguments: { x: -1, y: 0 } },
      }),
    ) as R
    expect(r.isError).toBe(true)
    expect((r.content?.[0]?.text ?? '').length).toBeGreaterThan(0)
  })

  it('da_ocr { displayId: null, lang: "eng" } returns structured lines/words/elements', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_ocr', arguments: { displayId: null, lang: 'eng' } },
      }),
    ) as R & {
      structuredContent: {
        source: string
        backend: string
        lines: unknown[]
        words: unknown[]
        elements: unknown[]
      }
    }
    expect(r.isError).toBeFalsy()
    expect(r.structuredContent.source).toBe('mock')
    expect(r.structuredContent.backend.length).toBeGreaterThan(0)
    expect(r.structuredContent.lines.length).toBeGreaterThan(0)
    expect(r.structuredContent.words.length).toBeGreaterThan(0)
    expect(r.structuredContent.elements.length).toBeGreaterThan(0)
  })

  it('da_ocr { lang: "" } is rejected with isError validation envelope', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_ocr', arguments: { displayId: null, lang: '' } },
      }),
    ) as R
    expect(r.isError).toBe(true)
    expect((r.content?.[0]?.text ?? '').length).toBeGreaterThan(0)
  })

  it('da_launch { argv: [] } is rejected with isError validation envelope', async () => {
    const { client } = await setupPair()
    const r = asResult(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_launch', arguments: { argv: [] } },
      }),
    ) as R
    expect(r.isError).toBe(true)
    expect((r.content?.[0]?.text ?? '').length).toBeGreaterThan(0)
  })

  it('unknown tool name surfaces as a JSON-RPC error (code -32602)', async () => {
    const { client } = await setupPair()
    const err = asError(
      await rpc(client, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'da_nonexistent', arguments: {} },
      }),
    )
    expect(err.code).toBe(-32602)
    expect(err.message.length).toBeGreaterThan(0)
  })

  it('close() resolves cleanly after multiple in-flight requests', async () => {
    const { client, server } = await setupPair()
    for (let i = 0; i < 5; i++) {
      const resp = await rpc(client, {
        jsonrpc: '2.0',
        id: 100 + i,
        method: 'tools/list',
        params: {},
      })
      expect('result' in resp).toBe(true)
    }
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('two independent server instances do not share transport state', async () => {
    const a = await setupPair()
    const b = await setupPair()
    expect(a.client).not.toBe(b.client)
    expect(a.server).not.toBe(b.server)
    const [ra, rb] = await Promise.all([
      rpc(a.client, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      rpc(b.client, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ])
    expect('result' in ra).toBe(true)
    expect('result' in rb).toBe(true)
  })
})
