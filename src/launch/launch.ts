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

// Shell metacharacters that would re-enable injection if any arg contained one
// when this arg is interpreted by a shell. The launcher always uses
// `child_process.spawn(cmd, args, { shell: false })` (verified at every
// `spawn`/`spawnSync` call site in this file) — args are passed directly to
// CreateProcessW / execve, never via cmd.exe or sh. So the dangerous set is
// "characters a shell would expand", NOT "characters that might exist in argv".
// On Windows `\` is the path separator (every absolute Windows path contains
// at least one), so blocking `\` rejects every Windows executable path and
// every Windows-path argument. Removed from the set.
//
// Matches: ; | & > < $ ` \n \r ( ) { } * ? [ ] ~ # ! ' "
const SHELL_METACHARS_REGEX = /[;|&>$`\n\r(){}*?[\]~#!'"]/

/** Convert a single MSYS-style POSIX path (`/c/Windows/...`) to a Windows-native
 *  path (`C:\Windows\...`). Used to normalise the output of Git for Windows'
 *  `which` command, which emits MSYS paths when Git Bash is on PATH. Node's
 *  `child_process.spawn` cannot interpret MSYS POSIX paths on Windows.
 *
 *  KNOWN LIMITATION: the regex matches any `/<single-letter>/...` pattern, so
 *  a path like `/usr/bin/git` (where `u` is the first segment) is also matched
 *  and converted to `U:\sr\bin\git`. In practice this rarely matters because
 *  Git for Windows' `which` returns paths under `/c/Program Files/Git/...`,
 *  where the conversion is correct.
 *
 *  No-op on non-Windows.
 *
 *  Exported for unit tests; not part of the public launch API.
 */
export function msysToWindowsPath(p: string): string {
  if (process.platform !== 'win32') return p
  if (!p.startsWith('/')) return p
  const m = /^\/(?<drive>[a-zA-Z])(?<rest>.*)$/.exec(p)
  if (!m || !m.groups) return p
  // Non-null assertions are sound: the named groups are part of the regex
  // pattern, so they are guaranteed to be present when `exec` returns a match.
  const drive = m.groups['drive']!.toUpperCase()
  // The regex captures `(?<rest>.*)` after `/<drive>`, so `rest` STILL starts
  // with `/` (e.g. `/c/Windows/...` -> drive=`c`, rest=`/Windows/...`). Strip
  // the leading slash first, then convert remaining separators.
  const rest = m.groups['rest']!.replace(/^\//, '').replace(/\//g, String.fromCharCode(92))
  return [drive, rest].join(String.fromCharCode(58, 92))
}

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
  // Absolute or relative path: skip PATH lookup, verify file exists directly.
  if (program.includes('/') || program.includes('\\')) {
    try {
      // On Windows, X_OK is essentially a no-op (NTFS doesn't track an exec
      // bit; X_OK only verifies the file is readable). F_OK verifies the file
      // actually exists at the path, which is what we want before spawn().
      // On POSIX, keep X_OK so non-executable files (e.g. /etc/passwd) are
      // correctly rejected.
      const mode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK
      accessSync(program, mode)
    } catch {
      throw new DaMcpError('ENOENT', `Program not found: ${program}`)
    }
    return program
  }
  // On Windows, walk PATH manually with PATHEXT instead of relying on `which`.
  // `which` is Git-for-Windows-specific and is NOT on PATH on stock Windows
  // installs, CI runners, and many production environments — so spawning
  // `which` always returned ENOENT there, breaking bare-name launch for every
  // program. resolveWindowsPath uses only Node + stdlib to walk PATH/PATHEXT,
  // matching the behaviour of CreateProcessW.
  if (process.platform === 'win32') {
    return resolveWindowsPath(program)
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
  let resolved = typeof stdout === 'string' ? stdout.trim() : ''
  if (resolved.length === 0) {
    throw new DaMcpError('ENOENT', `Program not found: ${program}`)
  }
  // Git for Windows' `which` emits MSYS-style POSIX paths (`/c/Windows/...`)
  // when Git Bash is on PATH. Node cannot spawn these — normalise to native
  // Windows paths before returning. No-op on POSIX or already-converted paths.
  resolved = msysToWindowsPath(resolved)
  return resolved
}

/**
 * Native Windows PATH resolver — walks `PATH` directories and tries each
 * extension in `PATHEXT` (plus the bare name). Returns the first existing
 * file, or throws ENOENT if none match.
 *
 * `PATH` and `PATHEXT` are both `;`-delimited. `PATHEXT` defaults to
 * `.EXE;.CMD;.BAT;.COM` when unset. The candidate is checked with F_OK
 * (existence), not X_OK — Windows has no exec bit and X_OK is a no-op.
 *
 * KNOWN LIMITATION: WindowsApps Store-app proxy entries (e.g. mspaint on
 * Windows 11) are reparse points that may report EACCES or be invisible to
 * F_OK from non-Store-aware callers. The user's resolution path is then
 * expected to fall through to the next PATH entry or fail with ENOENT —
 * which is correct behaviour, not a bug here. Such apps need to be launched
 * via the ShellExecute / `start` API rather than spawn().
 *
 * Exported for unit tests; not part of the public launch API.
 */
export function resolveWindowsPath(program: string): string {
  const WIN_SEP = String.fromCharCode(92) // '\'
  const WIN_PATH_SEP = String.fromCharCode(59) // ';'
  const pathDirs = (process.env['PATH'] ?? '')
    .split(WIN_PATH_SEP)
    .filter((s) => s.length > 0)
  const pathExts = (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM')
    .split(WIN_PATH_SEP)
    .filter((s) => s.length > 0)
  for (const dir of pathDirs) {
    // Try the bare name first (handles cases like `foo.bat` where the user
    // supplied the extension). PATHEXT entries like `.BAT` would otherwise
    // produce `foo.bat.BAT`, which doesn't exist.
    const bare = dir + WIN_SEP + program
    try {
      accessSync(bare, fsConstants.F_OK)
      return bare
    } catch {
      // not present — continue
    }
    // Then try each PATHEXT extension in order.
    for (const ext of pathExts) {
      const candidate = dir + WIN_SEP + program + ext
      try {
        accessSync(candidate, fsConstants.F_OK)
        return candidate
      } catch {
        // not present — continue
      }
    }
  }
  throw new DaMcpError('ENOENT', `Program not found in PATH: ${program}`)
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

  // Default-detached: da_launch is fire-and-forget; an agent that asks
  // "open mspaint" expects the app to stay open after the tool call returns.
  const detached = opts.detached ?? true

  const child: ChildProcess = spawn(resolvedPath, argv.slice(1), {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: toNodeStdio(opts.stdio),
    shell: false,
    detached,
  })

  // Drop the child handle from the parent's event loop. Without unref(),
  // the parent waits on the child even though detached:true makes the child
  // its own session leader on Unix; on Windows, parent exit can still pull
  // down detached children whose stdio/job object is shared with the parent.
  if (detached) {
    child.unref()
  }

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

  // detached (fire-and-forget apps): no default timeout — SIGTERMing a
  // long-running app because the caller forgot timeoutMs is a footgun.
  // Non-detached: defer to subprocessTimeoutMs (default for short CLIs).
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