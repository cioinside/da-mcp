/**
 * Windows-only WindowsApps / AppX reparse-stub launch support.
 *
 * Microsoft Store-installed apps (mspaint, msedge, WhatsApp, …) expose a
 * zero-byte reparse stub at `%LOCALAPPDATA%\Microsoft\WindowsApps\<app>.exe`
 * that `child_process.spawn()` / `CreateProcessW()` can launch but does
 * NOT initialise the AppX activation context for. The stub starts, then
 * exits cleanly within ~1 second without ever painting its window —
 * silent failure with no crash artefact, no WER report, no prefetch
 * record. Documented in issue #30.
 *
 * The fix is to dispatch through `ShellExecuteExW`, which IS AppX-aware.
 * `cmd.exe`'s `start` builtin wraps `ShellExecuteExW`; we spawn it via
 * `cmd /c start "" "<path>" <args>` with `shell:false`. The `""` slot
 * is `start`'s optional window-title arg — required when the first
 * quoted arg is the path, otherwise cmd interprets the path as the
 * title and never launches the program.
 *
 * The real AppX at `%ProgramFiles%\WindowsApps\<pkg>\...` is NOT matched
 * here — `CreateProcessW` works on those directly.
 *
 * The returned `SpawnHandle.pid` is cmd.exe's PID, NOT the target app's
 * — UWP apps do not expose a meaningful PID through this dispatch path.
 * Window / click / wait tools (`da_window_list`, `da_wait_for_window`,
 * `da_window_focus`) find the window via OS-level enumeration
 * (`EnumWindows`), so the PID mismatch is invisible to the rest of the
 * launch → wait → focus → click pipeline.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { buildSpawnHandle, toNodeStdio } from './spawn-handle.js'
import type { LaunchOpts, SpawnHandle } from './types.js'

/**
 * Pure path matcher for WindowsApps reparse-stub locations. Returns true
 * iff `p` ends in `…\AppData\Local\Microsoft\WindowsApps\<name>.<ext>` (or
 * the forward-slash equivalent). No filesystem access.
 *
 * Exported for unit tests; not part of the public launch API.
 */
export function isWindowsAppsStub(p: string): boolean {
  if (typeof p !== 'string' || p.length === 0) return false
  const norm = p.replace(/\//g, '\\').toLowerCase()
  // \appdata\local\microsoft\windowsapps\<name>.<ext>
  // <name> = any chars except the Windows-forbidden set \ / : * ? " < > |
  // <ext>  = 1-8 alphanumeric chars (DOS-style extension)
  return /\\appdata\\local\\microsoft\\windowsapps\\[^\\:*?"<>|]+\.[a-z0-9]{1,8}$/.test(norm)
}

/**
 * Launch `resolvedPath` (a WindowsApps reparse-stub) via cmd.exe's
 * `start` builtin so Windows `ShellExecuteExW` establishes the AppX
 * activation context. Returns the same `SpawnHandle` shape as
 * `launchProgram`'s direct-spawn path.
 *
 * `argv[1..]` is forwarded verbatim as the target's command-line. All
 * args have already passed `validateArgv` (shell-metachar rejection)
 * in `launchProgram` before this is called.
 */
export async function launchViaShellExecute(
  argv: readonly string[],
  resolvedPath: string,
  opts: LaunchOpts,
): Promise<SpawnHandle> {
  const detached = opts.detached ?? true
  const cmdArgv: readonly string[] = [
    '/c',
    'start',
    '""',
    resolvedPath,
    ...argv.slice(1),
  ]

  const child: ChildProcess = spawn('cmd.exe', cmdArgv, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: toNodeStdio(opts.stdio),
    shell: false,
    detached,
  })

  return buildSpawnHandle(child, opts, detached)
}