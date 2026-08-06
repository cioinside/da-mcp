/**
 * Injectable subprocess executor used by `da-mcp upgrade` and the
 * `install-service` / `uninstall-service` commands.
 *
 * Why a custom helper instead of `child_process.spawnSync` directly?
 *   1. Tests inject a mock `ExecFn` that records calls and returns canned
 *      results, so the upgrade pipeline can be unit-tested without touching
 *      a real git/npm/systemctl.
 *   2. The CLI commands must stream progress to the user — async with
 *      `spawn` is the only ergonomic option; we never want the synchronous
 *      variant on user-facing commands.
 *   3. Centralising `shell: false`, the `cwd`/`env` plumbing, and the
 *      stream-to-string capture keeps per-command modules tiny.
 *
 * Every spawn uses `shell: false` (MCP project rule). The factory
 * `defaultExec()` is the production implementation; tests pass a fake.
 */
import { spawn } from 'node:child_process'
import { DaMcpError } from '../errors.js'

export interface ExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

export interface ExecOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  /** If true, reject the returned promise when the child exits non-zero. Default false. */
  readonly throwOnError?: boolean
}

export type ExecFn = (
  cmd: string,
  args: readonly string[],
  opts?: ExecOptions,
) => Promise<ExecResult>

export function defaultExec(): ExecFn {
  return (cmd, args, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        shell: false,
        cwd: opts?.cwd,
        env: opts?.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (err) => {
        reject(new DaMcpError('INTERNAL', `${cmd} ${args.join(' ')} failed to start: ${err.message}`))
      })
      child.on('close', (code) => {
        if (code === null) {
          reject(new DaMcpError('INTERNAL', `${cmd} ${args.join(' ')} terminated by signal`))
          return
        }
        const result: ExecResult = { stdout, stderr, code }
        if (code !== 0 && opts?.throwOnError === true) {
          reject(new DaMcpError('NATIVE_FAILED', `${cmd} exited with code ${code}: ${stderr.trim()}`))
          return
        }
        resolve(result)
      })
    })
}