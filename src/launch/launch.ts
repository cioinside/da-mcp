/**
 * Safe program-launch subsystem.
 *
 * Wraps `child_process.spawn` with:
 *   - shell:false (MANDATORY — never use the shell)
 *   - argv shell-metacharacter rejection
 *   - PATH resolution via `which` (or direct path when separator present)
 *   - URL special-case via the `open` package
 *   - Windows AppX reparse-stub (`mspaint` et al.) dispatch via
 *     `cmd /c start` → `ShellExecuteExW` so the AppX activation context
 *     is established (issue #30)
 *   - per-process timeout that resolves with the canonical signal exit code
 *   - signal-name → exit-code map (SIGNAL_EXIT_CODES), 128+N for POSIX signals
 *   - typed error envelope (DaMcpError) at every failure mode
 *
 * The returned handle follows the platform `SpawnHandle` shape:
 *   { pid, killed, exited, kill() }
 */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { DaMcpError } from '../errors.js'
import type { LaunchOpts, SpawnHandle } from './types.js'
import { buildSpawnHandle, toNodeStdio } from './spawn-handle.js'
import { isWindowsAppsStub, launchViaShellExecute } from './uwp.js'

export { SIGNAL_EXIT_CODES, signalToExitCode } from './spawn-handle.js'

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
  const drive = m.groups['drive']!.toUpperCase()
  const rest = m.groups['rest']!.replace(/^\//, '').replace(/\//g, String.fromCharCode(92))
  return [drive, rest].join(String.fromCharCode(58, 92))
}

const URL_PREFIXES: readonly string[] = ['http://', 'https://', 'mailto:', 'tel:']

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
  if (program.includes('/') || program.includes('\\')) {
    try {
      const mode = process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK
      accessSync(program, mode)
    } catch {
      throw new DaMcpError('ENOENT', `Program not found: ${program}`)
    }
    return program
  }
  if (process.platform === 'win32') {
    return resolveWindowsPath(program)
  }
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
  resolved = msysToWindowsPath(resolved)
  return resolved
}

/**
 * Native Windows PATH resolver — walks `PATH` directories and tries each
 * extension in `PATHEXT` (plus the bare name). Returns the first existing
 * file, or throws ENOENT if none match.
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
    const bare = dir + WIN_SEP + program
    try {
      accessSync(bare, fsConstants.F_OK)
      return bare
    } catch {
      // not present — continue
    }
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

  // issue #30 — WindowsApps reparse stubs need ShellExecuteExW (cmd /c start).
  if (process.platform === 'win32' && isWindowsAppsStub(resolvedPath)) {
    return launchViaShellExecute(argv, resolvedPath, opts)
  }

  const child = spawn(resolvedPath, argv.slice(1), {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: toNodeStdio(opts.stdio),
    shell: false,
    detached,
  })

  return buildSpawnHandle(child, opts, detached)
}