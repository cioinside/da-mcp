/**
 * Shared spawn-handle builder for the launch subsystem.
 *
 * Both `launchProgram` (spawn direct path) and `launchViaShellExecute`
 * (Windows AppX reparse-stub path) need the same exit / timeout / kill
 * machinery. Centralising it here keeps the two call sites in lock-step
 * — diverging them on something as small as timeout semantics was the
 * pre-fix-class latent regression behind issue #30.
 *
 * `SIGNAL_EXIT_CODES` lives here because `signalToExitCode` is its only
 * consumer; `launch.ts` re-exports it so the existing public surface
 * (`import { SIGNAL_EXIT_CODES } from 'src/launch/launch.js'`) keeps
 * working unchanged.
 */
import { type ChildProcess } from 'node:child_process'
import { DaMcpError } from '../errors.js'
import { getConfig } from '../config.js'
import type { SpawnHandle } from './types.js'

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
export function signalToExitCode(signal: NodeJS.Signals | null): number | null {
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

/** Spread drops the readonly modifier so Node's mutable stdio array accepts it. */
export function toNodeStdio(s: 'inherit' | 'pipe' | 'ignore' | readonly [NodeJS.WritableStream | 'inherit' | 'pipe' | 'ignore', NodeJS.ReadableStream | 'inherit' | 'pipe' | 'ignore', NodeJS.ReadableStream | 'inherit' | 'pipe' | 'ignore'] | undefined): 'inherit' | 'pipe' | 'ignore' | import('node:child_process').StdioOptions {
  if (s === undefined) return 'ignore'
  if (typeof s === 'string') return s
  return [...s] as import('node:child_process').StdioOptions
}

/**
 * Wire `child`'s exit / error / timeout / kill semantics and return the
 * `SpawnHandle` shape. Both `launchProgram` and `launchViaShellExecute`
 * delegate here.
 *
 * `detached === true` (the default for launch tools) opts out of the
 * default subprocess timeout — SIGTERMing a long-running app because the
 * caller forgot `timeoutMs` is a footgun. `detached === false` falls
 * back to `subprocessTimeoutMs` (short-CLI helper case).
 */
export function buildSpawnHandle(
  child: ChildProcess,
  opts: { readonly timeoutMs?: number },
  detached: boolean,
): SpawnHandle {
  if (detached) child.unref()

  const terminationFlag = makeTerminationFlag()
  const exitedPromise = new Promise<number>((resolve, reject) => {
    child.on('exit', (code, signal) => {
      const exitCode = code ?? signalToExitCode(signal) ?? 1
      resolve(exitCode)
    })
    child.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      reject(new DaMcpError('NATIVE_FAILED', `Spawn failed: ${msg}`, err))
    })
  })

  const timeoutMs =
    opts.timeoutMs !== undefined
      ? opts.timeoutMs
      : detached
        ? 0
        : getConfig().subprocessTimeoutMs
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