/**
 * Integration test: spawn the actual CLI entry-point and verify it boots
 * and responds to an MCP `initialize` request over stdin.
 *
 * Regression catcher for the Windows CLI-silently-exits bug
 * (src/server-dispatch.ts: `import.meta.url === file://${process.argv[1]}`).
 * Without the fileURLToPath fix, this process exited within ~1 s on
 * Windows with no stdout and no error — undetectable from a plain
 * `npm test` invocation.
 *
 * Runs via `tsx` against the source (not dist) so the test never goes
 * stale relative to src/server-dispatch.ts. Uses DA_MCP_TEST_MODE=mock
 * to avoid real native I/O (@nut-tree-fork/nut-js, screenshot-desktop, etc.).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = resolve(__dirname, '../..')
const CLI_SRC = resolve(PROJECT_ROOT, 'src/server-dispatch.ts')

// Invoke via Node + `--import tsx/esm` so the test runs the latest TS source
// (no build step required) and avoids Windows `spawn EINVAL` for .cmd files.
const NODE_ARGS = ['--import', 'tsx/esm', CLI_SRC]

const INIT_PARAMS = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'cli-entry-test', version: '0.0.0' },
}

interface CliInstance {
  child: ChildProcess
  stdout: string
  stderr: string
  ready: Promise<void>
}

function spawnCli(): CliInstance {
  const child = spawn(process.execPath, NODE_ARGS, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      DA_MCP_TEST_MODE: 'mock',
      NO_COLOR: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const instance: CliInstance = {
    child,
    stdout: '',
    stderr: '',
    ready: new Promise<void>((resolveReady, rejectReady) => {
      const t = setTimeout(
        () =>
          rejectReady(
            new Error('startup timeout (10s); stderr=\n' + instance.stderr),
          ),
        10_000,
      )
      child.stderr?.on('data', (chunk: Buffer) => {
        instance.stderr += chunk.toString('utf8')
        if (instance.stderr.includes('da-mcp server started')) {
          clearTimeout(t)
          resolveReady()
        }
      })
      child.on('error', (err) => {
        clearTimeout(t)
        rejectReady(err)
      })
      child.on('exit', (code, signal) => {
        clearTimeout(t)
        rejectReady(
          new Error(
            `exited before ready: code=${code} signal=${signal}\nstderr=\n${instance.stderr}`,
          ),
        )
      })
    }),
  }

  return instance
}

const activeProcs: ChildProcess[] = []
afterEach(() => {
  while (activeProcs.length > 0) {
    const p = activeProcs.pop()
    if (p && !p.killed) p.kill('SIGTERM')
  }
})

describe('CLI entry-point (src/server-dispatch.ts)', () => {
  it('boots in stdio mode and stays alive after startup log', async () => {
    const cli = spawnCli()
    activeProcs.push(cli.child)
    await cli.ready
    // If the Windows bug were present, the process would have exited by now.
    expect(cli.child.exitCode).toBeNull()
    expect(cli.child.signalCode).toBeNull()
  }, 15_000)

  it('responds to an initialize request over stdin', async () => {
    const cli = spawnCli()
    activeProcs.push(cli.child)
    await cli.ready

    const responsePromise = new Promise<string>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error('rpc timeout (15s); stdout=\n' + cli.stdout)),
        15_000,
      )
      let buffer = ''
      cli.child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        cli.stdout += chunk.toString('utf8')
        const lines = buffer.split('\n')
        // Keep the trailing partial line (if any) in the buffer for next chunk.
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.length === 0) continue
          let parsed: { id?: unknown; jsonrpc?: unknown } | undefined
          try {
            parsed = JSON.parse(line)
          } catch {
            continue // not JSON, skip (probably a log line)
          }
          if (
            parsed &&
            parsed.jsonrpc === '2.0' &&
            parsed.id === 1
          ) {
            clearTimeout(t)
            resolve(line)
            return
          }
        }
      })
    })

    const initReq =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: INIT_PARAMS,
      }) + '\n'
    cli.child.stdin?.write(initReq)
    // NOTE: do NOT call stdin.end() — closing stdin triggers the MCP
    // stdio transport to terminate the server before it can respond
    // to the initialize request on the first connection.

    const response = await responsePromise
    const parsed = JSON.parse(response) as {
      jsonrpc: string
      id: number
      result?: {
        protocolVersion: string
        serverInfo?: { name: string; version: string }
      }
    }
    expect(parsed.jsonrpc).toBe('2.0')
    expect(parsed.id).toBe(1)
    expect(parsed.result).toBeDefined()
    expect(parsed.result?.serverInfo?.name).toBe('da-mcp')
    expect(parsed.result?.protocolVersion.length).toBeGreaterThan(0)
  }, 15_000)
})
