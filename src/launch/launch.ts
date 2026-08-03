/**
 * Safe program-launch subsystem.
 *
 * Wraps `child_process.spawn` with:
 *   - shell:false (MANDATORY — never use the shell)
 *   - argv shell-metacharacter rejection
 *   - PATH resolution via `which` (or direct path when separator present)
 *   - URL special-case via the `open` package
 *   - per-process timeout that resolves with the canonical signal exit code
 *   - signal-name → exit-code map (SIGNAL_EXIT_CODES), 128+N for POSIX signals
 *   - typed error envelope (DaMcpError) at every failure mode
 *
 * The returned handle follows the platform `SpawnHandle` shape:
 *   { pid, killed, exited, kill() }
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import type { LaunchOpts, SpawnHandle } from './types.js'

// Shell metacharacters that would re-enable injection if any arg contained one.
// Matches: ; | & > < $ ` \n \r ( ) { } * ? [ ] ~ # ! \ ' "
const SHELL_METACHARS_REGEX = /[;|&>$`\n\r(){}*?[\]~#!\\'"]/

const URL_PREFIXES: readonly string[] = ['http://', 'https://', 'mailto:', 'tel:']

/** POSIX exit codes for signal-terminated processes: `128 + signalNumber`. */
export const SIGNAL_EXIT_CODES = {
  SIGHUP: 128 + 1,
  SIGINT: 128 + 2,
  SIGQUIT: 128 + 3,
  SIGABRT: 128 + 6,
  SIGKILL: 128 + 9,
  SIGTERM: 128 + 15,
} as const

interface TerminationFlag {
  killed: boolean
  reason: 'timeout' | 'manual' | null
}

function makeTerminationFlag(): TerminationFlag {
  return { killed: false, reason: null }
}

/** `null` → `null`; unknown signal → `128`; otherwise 128 + signal number. */
function signalToExitCode(signal: NodeJS.Signals | null): number | null {
  if (signal === null) return null
  const map: Record<string, number> = {
    SIGHUP: SIGNAL_EXIT_CODES.SIGHUP,
    SIGINT: SIGNAL_EXIT_CODES.SIGINT,
    SIGQUIT: SIGNAL_EXIT_CODES.SIGQUIT,
    SIGABRT: SIGNAL_EXIT_CODES.SIGABRT,
    SIGKILL: SIGNAL_EXIT_CODES.SIGKILL,
    SIGTERM: SIGNAL_EXIT_CODES.SIGTERM,
  }
  return map[signal] ?? 128
}

/** Idempotent: marks `flag`, sends `signal` to `child`, returns kill() success. */
function terminateChild(
  child: ChildProcess,
  signal: NodeJS.Signals,
  flag: TerminationFlag,
  reason: 'timeout' | 'manual',
): boolean {
  if (flag.killed) return false
  flag.killed = true
  flag.reason = reason
  try {
    return child.kill(signal)
  } catch {
    return false
  }
}

/** True iff `s` contains no shell metacharacters. */
export function isShellSafe(s: string): boolean {
  return !SHELL_METACHARS_REGEX.test(s)
}

function validateArgv(argv: readonly unknown[]): void {
  if (!Array.isArray(argv) || argv.length < 1) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'argv must contain at least one element',
    )
  }
  const head = argv[0]
  if (typeof head !== 'string' || head.length === 0) {
    throw new DaMcpError(
      'INVALID_ARGUMENT',
      'argv[0] must be a non-empty string',
    )
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (typeof arg !== 'string') {
      throw new DaMcpError('INVALID_ARGUMENT', `argv[${i}] must be a string`)
    }
    if (!isShellSafe(arg)) {
      throw new DaMcpError(
        'SHELL_INJECTION_DETECTED',
        `arg contains shell metacharacter: ${arg}`,
      )
    }
  }
}

function isUrl(s: string): boolean {
  for (const prefix of URL_PREFIXES) {
    if (s.startsWith(prefix)) return true
  }
  return false
}

function resolveProgram(program: string): string {
  // Absolute or relative path: skip PATH lookup, verify executable bit directly.
  if (program.includes('/') || program.includes('\\')) {
    try {
      accessSync(program, fsConstants.X_OK)
    } catch {
      throw new DaMcpError('ENOENT', `Program not found: ${program}`)
    }
    return program
  }
  // PATH lookup via `which`. shell:false, capture stdout to learn the resolved path.
  const which = spawnSync('which', [program], {
    shell: false,
    encoding: 'utf8',
  })
  if (which.status !== 0) {
    throw new DaMcpError('ENOENT', `Program not found: ${program}`)
  }
  const stdout = which.stdout
  const resolved = typeof stdout === 'string' ? stdout.trim() : ''
  if (resolved.length === 0) {
    throw new DaMcpError('ENOENT', `Program not found: ${program}`)
  }
  return resolved
}

// Spread drops the readonly modifier so Node's mutable stdio array accepts it.
function toNodeStdio(s: LaunchOpts['stdio']): import('node:child_process').StdioOptions {
  if (s === undefined) return 'ignore'
  if (typeof s === 'string') return s
  return [...s] as import('node:child_process').StdioOptions
}

async function launchUrl(url: string): Promise<SpawnHandle> {
  const openMod = await import('open')
  const openFn = openMod.default
  try {
    await openFn(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new DaMcpError('NATIVE_FAILED', `Failed to open URL: ${msg}`, err)
  }
  // open() resolves when the URL handler is launched. We do not track the
  // handler's PID (xdg-open / open / start detach from us); the handle is
  // a fire-and-forget marker that the URL was dispatched.
  return {
    pid: null,
    killed: false,
    exited: Promise.resolve(0),
    kill: () => {
      /* URL handler lifecycle is owned by the OS / xdg-open */
    },
  }
}

export async function launchProgram(
  argv: readonly string[],
  opts: LaunchOpts = {},
): Promise<SpawnHandle> {
  validateArgv(argv)
  const head = argv[0] as string

  if (isUrl(head)) {
    return launchUrl(head)
  }

  const resolvedPath = resolveProgram(head)

  const child: ChildProcess = spawn(resolvedPath, argv.slice(1), {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: toNodeStdio(opts.stdio),
    shell: false,
    detached: opts.detached ?? true,
  })

  const terminationFlag = makeTerminationFlag()
  const exitedPromise = new Promise<number>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      // POSIX: signal-terminated process reports 128 + signal number.
      // code wins if the OS reports a real exit code; otherwise map the signal.
      const exitCode = code ?? signalToExitCode(signal) ?? 1
      resolve(exitCode)
    })
    child.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      reject(new DaMcpError('NATIVE_FAILED', `Spawn failed: ${msg}`, err))
    })
  })

  const timeoutMs = opts.timeoutMs ?? getConfig().subprocessTimeoutMs
  let finalExited: Promise<number> = exitedPromise
  if (typeof timeoutMs === 'number' && timeoutMs > 0) {
    let timer: NodeJS.Timeout | null = null
    const timeoutPromise = new Promise<number>((resolve) => {
      timer = setTimeout(() => {
        terminateChild(child, 'SIGTERM', terminationFlag, 'timeout')
        resolve(SIGNAL_EXIT_CODES.SIGTERM)
      }, timeoutMs)
    })
    finalExited = Promise.race([exitedPromise, timeoutPromise]).finally(() => {
      if (timer !== null) clearTimeout(timer)
    })
  }

  return {
    pid: child.pid ?? null,
    get killed(): boolean {
      return terminationFlag.killed
    },
    exited: finalExited,
    kill: () => {
      terminateChild(child, 'SIGTERM', terminationFlag, 'manual')
    },
  }
}