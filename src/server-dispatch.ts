/**
 * CLI dispatch for the `node dist/server-dispatch.js` entry point.
 *
 * Lives outside server.ts to keep that module focused on stdio MCP
 * server creation (and under the 250 LOC ceiling). Handles:
 *
 *   - `node dist/server-dispatch.js`              → stdio (default)
 *   - `node dist/server-dispatch.js token regenerate`  → prints HTTP URL
 *   - `node dist/server-dispatch.js upgrade [--force]` → git pull + rebuild
 *   - `node dist/server-dispatch.js install-service`   → systemd / launchd / SCM
 *   - `node dist/server-dispatch.js uninstall-service` → inverse of above
 *   - anything else with `token` as argv[2]        → usage on stderr, exit 2
 *
 * The `upgrade` / service commands return a non-zero process exit code on
 * failure via the surrounding `.catch`; success messages are written to
 * stdout so they can be piped (`da-mcp upgrade | tee /var/log/...`).
 */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runServer,
  runHttpServer,
  runTokenRegenerate,
} from './server.js'
import { defaultExec } from './cli/exec.js'
import { runUpgrade, type UpgradeResult } from './cli/upgrade.js'
import { installService } from './cli/install-service.js'
import { uninstallService } from './cli/install-service.js'

function readTransportFromEnv(): 'stdio' | 'http' {
  return process.env['DA_MCP_TRANSPORT'] === 'http' ? 'http' : 'stdio'
}

function runWithTransport(): Promise<void> {
  const transport = readTransportFromEnv()
  return transport === 'http' ? runHttpServer() : runServer()
}

function resolveProjectRoot(): string {
  // src/server-dispatch.ts → ../../ = repo root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
}

function stdoutLine(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

function commonServiceOpts() {
  return {
    projectRoot: resolveProjectRoot(),
    exec: defaultExec(),
    env: process.env,
    log: stdoutLine,
    home: os.homedir(),
    uid: process.getuid?.() ?? 0,
    user: process.env['USER'] ?? process.env['USERNAME'] ?? 'daemon',
    nodePath: process.execPath,
  }
}

function printUpgradeSummary(r: UpgradeResult): void {
  stdoutLine(`da-mcp upgrade on ${r.branch}: ${r.before.slice(0, 7)}... → ${r.after.slice(0, 7)}...`)
  stdoutLine(`changed: ${r.changed ? 'yes' : 'no'}`)
  if (r.steps.length > 0) {
    stdoutLine(`steps: ${r.steps.join(', ')}`)
  }
  stdoutLine(`service restart: ${r.restart.attempted ? (r.restart.ok ? 'ok' : 'failed') : 'skipped'} — ${r.restart.detail}`)
  stdoutLine('Refresh the da-ui-orchestrator skill on your MCP client:')
  stdoutLine('  mkdir -p ~/.config/opencode/skills/da-ui-orchestrator')
  stdoutLine('  cp docs/skills/da-ui-orchestrator.md ~/.config/opencode/skills/da-ui-orchestrator/SKILL.md')
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
    process.stderr.write('usage: node dist/server-dispatch.js token regenerate\n')
    process.exit(2)
  }
  if (argv[2] === 'upgrade') {
    const force = argv.includes('--force') || argv.includes('-f')
    return runUpgrade({
      projectRoot: resolveProjectRoot(),
      force,
      exec: defaultExec(),
      env: process.env,
      log: stdoutLine,
    }).then(printUpgradeSummary).then(() => undefined)
  }
  if (argv[2] === 'install-service') {
    return installService(commonServiceOpts()).then((r) => {
      stdoutLine(`da-mcp service installed for ${r.platform}. Target: ${r.targetPath}`)
    })
  }
  if (argv[2] === 'uninstall-service') {
    return uninstallService(commonServiceOpts()).then((r) => {
      stdoutLine(`da-mcp service removed for ${r.platform}.`)
    })
  }
  if (argv[2] === 'help' || argv[2] === '--help' || argv[2] === '-h') {
    printUsage()
    return Promise.resolve()
  }
  return runWithTransport()
}

function printUsage(): void {
  process.stdout.write(
    [
      'da-mcp — cross-platform desktop automation MCP server',
      '',
      'Usage:',
      '  node dist/server-dispatch.js                     run the stdio MCP server (default)',
      '  node dist/server-dispatch.js token regenerate    regenerate the HTTP auth token',
      '  node dist/server-dispatch.js upgrade [--force]   pull origin, rebuild, restart service',
      '  node dist/server-dispatch.js install-service     register systemd / launchd / Windows service',
      '  node dist/server-dispatch.js uninstall-service   remove the registered service',
      '  node dist/server-dispatch.js help                show this message',
      '',
      'Environment variables:',
      '  DA_MCP_TRANSPORT    stdio (default) or http — transport for the running server',
      '  DA_MCP_HTTP_HOST    bind address (default 0.0.0.0)',
      '  DA_MCP_PORT         HTTP port (default 3000)',
      '  DA_MCP_TOKEN_PATH   override token-file location',
      '',
    ].join('\n'),
  )
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  runCli(process.argv).catch((err: unknown) => {
    process.stderr.write(`da-mcp fatal: ${String(err)}\n`)
    process.exit(1)
  })
}