/**
 * `da-mcp upgrade` — pull the latest committed version on the current branch,
 * reinstall, rebuild, and restart the service if one is registered.
 *
 * The command is a single CLI subcommand (`node dist/server-dispatch.js upgrade`)
 * intended for both interactive use and cron/systemd-timer-driven unattended
 * updates. It is intentionally non-interactive: dirty working trees abort
 * unless `--force` is passed (which discards local changes — destructive).
 *
 * Pipeline:
 *   1. `git status --porcelain`               → refuse if dirty + !force
 *   2. `git rev-parse --abbrev-ref HEAD`      → resolve current branch
 *   3. `git fetch origin <branch>`            → sync origin refs
 *   4. `git reset --hard origin/<branch>`     → fast-forward working tree
 *   5. `npm ci`                               → locked dependency install
 *   6. `npm run build`                        → compile TS to dist/
 *   7. `npm run typecheck`                    → strict-mode smoke check
 *   8. If a `da-mcp` system service is registered → restart it via the
 *      platform-appropriate supervisor (systemctl / launchctl / sc.exe).
 *      Otherwise print a one-line reminder to restart the MCP client.
 *
 * All subprocess calls go through the injected `ExecFn` so tests can mock
 * git/npm without touching the real toolchain. Production wiring uses
 * `defaultExec()` from `./exec.js`.
 */
import { DaMcpError } from '../errors.js'
import { attemptServiceRestart } from './install-service.js'
import { defaultExec, type ExecFn } from './exec.js'

export interface UpgradeOptions {
  readonly projectRoot: string
  readonly force: boolean
  readonly exec: ExecFn
  readonly env: NodeJS.ProcessEnv
  readonly log: (msg: string) => void
  readonly platform?: 'linux' | 'darwin' | 'win32'
}

export interface UpgradeResult {
  readonly branch: string
  readonly before: string
  readonly after: string
  readonly changed: boolean
  readonly steps: readonly string[]
  readonly restart: { attempted: boolean; ok: boolean; detail: string }
}

function fail(message: string): never {
  throw new DaMcpError('INTERNAL', message)
}

async function runGit(
  exec: ExecFn,
  args: readonly string[],
  cwd: string,
  label: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const res = await exec('git', args, { cwd })
  if (res.code !== 0) {
    fail(`git ${label} failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
  }
  return res
}

async function runNpm(
  exec: ExecFn,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<boolean> {
  const res = await exec('npm', args, { cwd, env })
  if (res.code !== 0) {
    fail(`npm ${label} failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`)
  }
  return true
}

export async function runUpgrade(opts: UpgradeOptions): Promise<UpgradeResult> {
  const { projectRoot, force, exec, env, log } = opts

  // 1. Working tree clean?
  const status = await exec('git', ['status', '--porcelain'], { cwd: projectRoot })
  if (status.stdout.trim().length > 0 && !force) {
    fail(
      'Working tree has uncommitted changes. Run `git status`, commit/stash, '
        + 'or pass --force to discard them.',
    )
  }

  // 2. Resolve current branch
  const branchRes = await runGit(exec, ['rev-parse', '--abbrev-ref', 'HEAD'], projectRoot, 'rev-parse')
  const branch = branchRes.stdout.trim()
  if (branch.length === 0 || branch === 'HEAD') {
    fail('Detached HEAD cannot be upgraded; check out a branch first.')
  }

  // 3. Capture before SHA
  const beforeRes = await runGit(exec, ['rev-parse', 'HEAD'], projectRoot, 'rev-parse')
  const before = beforeRes.stdout.trim()

  // 4. Fetch + reset
  log(`fetching origin/${branch}...`)
  await runGit(exec, ['fetch', 'origin', branch], projectRoot, 'fetch')

  log(`resetting to origin/${branch}...`)
  await runGit(exec, ['reset', '--hard', `origin/${branch}`], projectRoot, 'reset --hard')

  const afterRes = await runGit(exec, ['rev-parse', 'HEAD'], projectRoot, 'rev-parse')
  const after = afterRes.stdout.trim()
  const changed = before !== after

  const steps: string[] = ['git reset --hard']
  if (!changed) {
    log('already up to date; skipping npm ci/build/typecheck.')
  } else {
    log('running npm ci...')
    await runNpm(exec, ['ci'], projectRoot, env, 'ci')
    steps.push('npm ci')

    log('running npm run build...')
    await runNpm(exec, ['run', 'build'], projectRoot, env, 'run build')
    steps.push('npm run build')

    log('running npm run typecheck...')
    await runNpm(exec, ['run', 'typecheck'], projectRoot, env, 'run typecheck')
    steps.push('npm run typecheck')
  }

  // 8. Restart service if installed
  log('checking for installed da-mcp system service...')
  const restart = await attemptServiceRestart({
    projectRoot,
    exec,
    env,
    ...(opts.platform !== undefined ? { platform: opts.platform } : {}),
  })

  return { branch, before, after, changed, steps, restart }
}

export function makeUpgradeRunner(): (opts: UpgradeOptions) => Promise<UpgradeResult> {
  const exec = defaultExec()
  return (opts) => runUpgrade({ ...opts, exec })
}