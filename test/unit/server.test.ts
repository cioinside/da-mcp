/**
 * Unit tests for src/server.ts MCP entrypoint.
 *
 * Covers:
 *  - factory registration: 12 tools registered under expected names
 *  - wrapHandlerResult: success path and DaMcpError envelope shape
 *  - transport lifecycle: connect via InMemoryTransport, close cleanly
 *
 * Mock mode keeps every handler side-effect-free so we can exercise the
 * wrapper / factory / transport boundary without touching native APIs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { McpServer, InMemoryTransport } from '@modelcontextprotocol/server'

import { initConfig, resetConfig } from '../../src/config.js'
import { DaMcpError } from '../../src/errors.js'
import { ALL_TOOLS } from '../../src/tools/index.js'
import { createMcpServer, wrapHandlerResult } from '../../src/server.js'
import { SERVER_INSTRUCTIONS } from '../../src/server-instructions.js'

const TRACKED = ['DA_MCP_TEST_MODE'] as const
type TrackedKey = (typeof TRACKED)[number]
let savedEnv: Record<TrackedKey, string | undefined>

beforeEach(() => {
  savedEnv = { DA_MCP_TEST_MODE: process.env['DA_MCP_TEST_MODE'] }
  process.env['DA_MCP_TEST_MODE'] = 'mock'
  resetConfig()
  initConfig({ DA_MCP_TEST_MODE: 'mock' })
})

afterEach(() => {
  resetConfig()
  for (const k of TRACKED) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

const EXPECTED_NAMES = [
  'da_screenshot',
  'da_ocr',
  'da_list_displays',
  'da_get_mouse_position',
  'da_move_mouse',
  'da_click',
  'da_double_click',
  'da_drag',
  'da_scroll',
  'da_type',
  'da_key',
  'da_launch',
] as const

describe('createMcpServer', () => {
  it('returns an McpServer instance', () => {
    const server = createMcpServer()
    expect(server).toBeInstanceOf(McpServer)
  })

  it('registers all 12 da_* tools with the SDK', () => {
    const server = createMcpServer()
    const registered = (server as unknown as {
      _registeredTools: Record<string, unknown>
    })._registeredTools
    const names = Object.keys(registered).sort()
    expect(names).toEqual([...EXPECTED_NAMES].sort())
  })

  it('preserves tool descriptions from ALL_TOOLS', () => {
    const server = createMcpServer()
    const registered = (server as unknown as {
      _registeredTools: Record<string, { description: string }>
    })._registeredTools
    for (const tool of ALL_TOOLS) {
      expect(registered[tool.name]?.description).toBe(tool.description)
    }
  })

  it('matches the total count declared by ALL_TOOLS', () => {
    const server = createMcpServer()
    const registered = (server as unknown as {
      _registeredTools: Record<string, unknown>
    })._registeredTools
    expect(Object.keys(registered).length).toBe(ALL_TOOLS.length)
    expect(ALL_TOOLS.length).toBe(12)
  })

  it('per-call factory creates independent instances', () => {
    const a = createMcpServer()
    const b = createMcpServer()
    expect(a).not.toBe(b)
  })

  it('wires SERVER_INSTRUCTIONS into the McpServer instance', () => {
    const server = createMcpServer()
    const innerServer = (server as unknown as {
      server: { _instructions?: string }
    }).server
    expect(innerServer._instructions).toBe(SERVER_INSTRUCTIONS)
  })
})

describe('SERVER_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof SERVER_INSTRUCTIONS).toBe('string')
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(0)
  })

  it('mentions every da_* tool exposed by the server', () => {
    for (const tool of ALL_TOOLS) {
      expect(SERVER_INSTRUCTIONS).toContain(tool.name)
    }
  })

  it('explicitly forbids writing an orchestrator script', () => {
    expect(SERVER_INSTRUCTIONS).toContain('Do NOT write an orchestrator script')
    expect(SERVER_INSTRUCTIONS).toContain('child_process.spawn')
    expect(SERVER_INSTRUCTIONS).toMatch(/single|direct/)
  })

  it('identifies the AI agent as the orchestrator', () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/ARE the orchestrator/)
  })
})

describe('wrapHandlerResult', () => {
  it('serializes a successful result into content + structuredContent', async () => {
    const out = await wrapHandlerResult(
      async () => ({ ok: true, n: 7 }),
      {},
    )
    expect(out.isError).toBeUndefined()
    expect(out.structuredContent).toEqual({ ok: true, n: 7 })
    expect(out.content).toHaveLength(1)
    const first = out.content[0]
    expect(first?.type).toBe('text')
    if (first?.type === 'text') {
      const parsed: unknown = JSON.parse(first.text)
      expect(parsed).toEqual({ ok: true, n: 7 })
    }
  })

  it('wraps a DaMcpError into an isError envelope with both representations', async () => {
    const out = await wrapHandlerResult(async () => {
      throw new DaMcpError('OUT_OF_BOUNDS', 'mouse outside screen')
    }, {})
    expect(out.isError).toBe(true)
    const structured = out.structuredContent as { error: { code: string; message: string } }
    expect(structured.error.code).toBe('OUT_OF_BOUNDS')
    expect(structured.error.message).toBe('mouse outside screen')
    expect(out.content).toHaveLength(1)
    const first = out.content[0]
    if (first?.type === 'text') {
      const parsed: unknown = JSON.parse(first.text)
      expect(parsed).toMatchObject({
        code: 'OUT_OF_BOUNDS',
        message: 'mouse outside screen',
      })
    }
  })

  it('converts a plain Error into a DaMcpError via toDaMcpError', async () => {
    const out = await wrapHandlerResult(async () => {
      throw new Error('boom')
    }, {})
    expect(out.isError).toBe(true)
    const structured = out.structuredContent as { error: { code: string; message: string } }
    expect(structured.error.code).toBe('INTERNAL')
    expect(structured.error.message).toBe('boom')
  })

  it('promotes a non-Error throw value to a DaMcpError', async () => {
    const out = await wrapHandlerResult(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-throw'
    }, {})
    expect(out.isError).toBe(true)
    const structured = out.structuredContent as { error: { code: string; message: string } }
    expect(structured.error.code).toBe('INTERNAL')
    expect(structured.error.message).toBe('string-throw')
  })

  it('forwards handler args verbatim to the wrapped function', async () => {
    let captured: unknown = null
    const out = await wrapHandlerResult(
      async (input: unknown) => {
        captured = input
        return { echoed: input }
      },
      { x: 1, y: 2 },
    )
    expect(captured).toEqual({ x: 1, y: 2 })
    expect(out.structuredContent).toEqual({ echoed: { x: 1, y: 2 } })
  })
})

describe('transport lifecycle', () => {
  it('connects to an InMemoryTransport and closes cleanly', async () => {
    const server = createMcpServer()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await server.close()
    // Client side still has a working message-receive path; ensure no throw on
    // a benign inspection (transport should be open until explicitly closed).
    expect(clientTransport).toBeDefined()
  })

  it('close() is idempotent after a successful connect', async () => {
    const server = createMcpServer()
    const [, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await server.close()
    // Second close should not reject — the SDK resolves it as a no-op.
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('two independent servers do not share registered-tool state', () => {
    const a = createMcpServer()
    const b = createMcpServer()
    const aReg = (a as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    const bReg = (b as unknown as { _registeredTools: Record<string, unknown> })._registeredTools
    // Mutating one should not be visible on the other (separate objects).
    expect(aReg).not.toBe(bReg)
    expect(Object.keys(aReg).length).toBe(12)
    expect(Object.keys(bReg).length).toBe(12)
  })
})
