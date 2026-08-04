/**
 * CLI dispatch for the `node dist/server.js` entry point.
 *
 * Lives outside server.ts to keep that module focused on stdio MCP
 * server creation (and under the 250 LOC ceiling). Handles:
 *
 *   - `node dist/server.js`              → stdio (default)
 *   - `node dist/server.js token regenerate`  → prints HTTP URL
 *   - `node dist/server.js token generate`    → alias of `regenerate`
 *   - anything else with `token` as argv[2]  → usage on stderr, exit 2
 */
import {
  runServer,
  runHttpServer,
  runTokenRegenerate,
} from './server.js'

function readTransportFromEnv(): 'stdio' | 'http' {
  return process.env['DA_MCP_TRANSPORT'] === 'http' ? 'http' : 'stdio'
}

function runWithTransport(): Promise<void> {
  const transport = readTransportFromEnv()
  return transport === 'http' ? runHttpServer() : runServer()
}

/**
 * Run the CLI's top-level dispatch. Resolves once the chosen subcommand
 * completes; the caller is responsible for process exit on error.
 */
export function runCli(argv: readonly string[]): Promise<void> {
  if (argv[2] === 'token' && (argv[3] === 'regenerate' || argv[3] === 'generate')) {
    return runTokenRegenerate()
  }
  if (argv[2] === 'token') {
    process.stderr.write('usage: node dist/server.js token regenerate\n')
    process.exit(2)
  }
  return runWithTransport()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).catch((err: unknown) => {
    process.stderr.write(`da-mcp fatal: ${String(err)}\n`)
    process.exit(1)
  })
}