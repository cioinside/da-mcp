/**
 * `da-mcp install-service` and the shared `attemptServiceRestart` helper
 * used by `da-mcp upgrade` after a successful rebuild.
 *
 *   install-service            → write the OS-specific service definition,
 *                                enable and start it via the supervisor
 *                                (systemd / launchd / SCM).
 *   uninstall-service          → stop, disable, and remove the definition.
 *   attemptServiceRestart      → called by upgrade after `npm run build`
 *                                to bounce the running daemon. Returns
 *                                `{ attempted, ok, detail }` so the upgrade
 *                                command can print a single summary line.
 *
 * OS-specific supervisor commands:
 *   Linux      → `systemctl --user {enable,start,stop,disable}` + writing
 *                ~/.config/systemd/user/da-mcp.service. No sudo required
 *                because it's a user unit.
 *   macOS      → writing ~/Library/LaunchAgents/com.da-mcp.daemon.plist +
 *                `launchctl {load,unload} -w`. No sudo required.
 *   Windows    → PowerShell `New-Service`/`Remove-Service` (which wraps
 *                `sc.exe create`/`sc.exe delete`). Must be run elevated.
 *                The daemon runs under LocalSystem and launches
 *                `node.exe "<projectRoot>\dist\server-dispatch.js"`.
 *
 * All platform-specific behaviour is dispatched by `detectOs()`. The
 * Windows code path reads from a PowerShell script bundled at
 * `scripts/windows/da-mcp-service.ps1` so operators can audit / re-run it
 * by hand without invoking `node`.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { detectOs } from '../platform/detect.js'
import { DaMcpError } from '../errors.js'
import {
  loadServiceTemplate,
  renderTemplate,
  resolveServiceTargetPath,
  type ServicePlatform,
  type ServiceRenderVars,
} from './service-templates.js'
import { defaultExec, type ExecFn } from './exec.js'

export interface InstallServiceOptions {
  readonly projectRoot: string
  readonly exec: ExecFn
  readonly env: NodeJS.ProcessEnv
  readonly log: (msg: string) => void
  readonly home: string
  readonly uid: number
  readonly user: string
  readonly nodePath: string
  readonly platform?: ServicePlatform
}

export interface InstallServiceResult {
  readonly platform: ServicePlatform
  readonly targetPath: string
  readonly installed: boolean
}

export interface RestartAttempt {
  readonly attempted: boolean
  readonly ok: boolean
  readonly detail: string
}

function ensurePlatform(override: ServicePlatform | undefined): ServicePlatform {
  const os = override ?? detectOs()
  if (os === 'linux' || os === 'darwin' || os === 'win32') return os
  throw new DaMcpError('PLATFORM_INIT_FAILED', `Cannot manage system service on OS '${os}'.`)
}

function buildVars(opts: InstallServiceOptions, transport: 'stdio' | 'http'): ServiceRenderVars {
  return {
    projectRoot: opts.projectRoot,
    nodePath: opts.nodePath,
    user: opts.user,
    uid: String(opts.uid),
    home: opts.home,
    transport,
    logPath: `${opts.home}/.local/share/da-mcp/daemon.log`,
  }
}

export async function installService(opts: InstallServiceOptions): Promise<InstallServiceResult> {
  const platform = ensurePlatform(opts.platform)
  const transport: 'stdio' | 'http' = opts.env['DA_MCP_TRANSPORT'] === 'stdio' ? 'stdio' : 'http'
  const target = resolveServiceTargetPath(platform, opts.home)
  const vars = buildVars(opts, transport)

  if (platform === 'win32') {
    return await installWindowsService(opts, vars)
  }
  opts.log(`rendering service template for ${platform}...`)
  const templateFile = platform === 'darwin' ? 'com.da-mcp.daemon.plist' : 'da-mcp.service'
  const template = loadServiceTemplate(platform, opts.projectRoot, templateFile)
  const rendered = renderTemplate(template, vars)
  return installPosixService(opts, platform, target.path, rendered)
}

async function installPosixService(
  opts: InstallServiceOptions,
  platform: 'linux' | 'darwin',
  targetPath: string,
  rendered: string,
): Promise<InstallServiceResult> {
  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, rendered, 'utf8')
  opts.log(`wrote ${targetPath}`)

  if (platform === 'linux') {
    await runOrFail(opts.exec, 'systemctl', ['--user', 'daemon-reload'], opts.env, 'daemon-reload')
    await runOrFail(opts.exec, 'systemctl', ['--user', 'enable', 'da-mcp.service'], opts.env, 'enable')
    await runOrFail(opts.exec, 'systemctl', ['--user', 'start', 'da-mcp.service'], opts.env, 'start')
  } else {
    await runOrFail(opts.exec, 'launchctl', ['load', '-w', targetPath], opts.env, 'launchctl load')
  }

  return { platform, targetPath, installed: true }
}

async function installWindowsService(
  opts: InstallServiceOptions,
  vars: ServiceRenderVars,
): Promise<InstallServiceResult> {
  const ps = process.env['SystemRoot'] !== undefined
    ? `${process.env['SystemRoot']}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    : 'powershell.exe'
  const scriptPath = `${opts.projectRoot}\\scripts\\windows\\da-mcp-service.ps1`
  const winEnv: NodeJS.ProcessEnv = {
    ...opts.env,
    DA_MCP_NODE_PATH: vars.nodePath,
    DA_MCP_PROJECT_ROOT: vars.projectRoot,
    DA_MCP_TRANSPORT_VALUE: vars.transport,
    DA_MCP_LOG_PATH: vars.logPath,
  }
  await runOrFail(
    opts.exec,
    ps,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', 'Install'],
    winEnv,
    'install-service.ps1',
  )
  return { platform: 'win32', targetPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\da-mcp', installed: true }
}

export async function uninstallService(opts: InstallServiceOptions): Promise<InstallServiceResult> {
  const platform = ensurePlatform(opts.platform)
  const target = resolveServiceTargetPath(platform, opts.home)
  opts.log(`removing da-mcp service for ${platform}...`)

  if (platform === 'linux') {
    await runAllowFail(opts.exec, 'systemctl', ['--user', 'disable', '--now', 'da-mcp.service'], opts.env)
    await runAllowFail(opts.exec, 'systemctl', ['--user', 'daemon-reload'], opts.env)
  } else if (platform === 'darwin') {
    await runAllowFail(opts.exec, 'launchctl', ['unload', '-w', target.path], opts.env)
  } else {
    const ps = process.env['SystemRoot'] !== undefined
      ? `${process.env['SystemRoot']}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe'
    const scriptPath = `${opts.projectRoot}\\scripts\\windows\\da-mcp-service.ps1`
    await runAllowFail(opts.exec, ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, 'Uninstall'], opts.env)
  }
  return { platform, targetPath: target.path, installed: false }
}

async function runOrFail(
  exec: ExecFn,
  cmd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  const res = await exec(cmd, args, { env })
  if (res.code !== 0) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `${label} failed (exit ${res.code}): ${res.stderr.trim() || res.stdout.trim()}`,
    )
  }
}

async function runAllowFail(
  exec: ExecFn,
  cmd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await exec(cmd, args, { env })
}

export async function attemptServiceRestart(opts: {
  readonly projectRoot: string
  readonly exec: ExecFn
  readonly env: NodeJS.ProcessEnv
  readonly platform?: ServicePlatform
}): Promise<RestartAttempt> {
  const platform = opts.platform ?? detectOs()
  if (platform === 'unknown') {
    return { attempted: false, ok: false, detail: 'unknown platform; skipped service restart.' }
  }
  const installed = await isServiceInstalled(opts.exec, platform, opts.env)
  if (!installed) {
    return { attempted: false, ok: false, detail: 'no da-mcp system service installed; restart your MCP client manually.' }
  }
  try {
    if (platform === 'linux') {
      await runOrFail(opts.exec, 'systemctl', ['--user', 'restart', 'da-mcp.service'], opts.env, 'systemctl restart')
    } else if (platform === 'darwin') {
      await runOrFail(opts.exec, 'launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? 0}/com.da-mcp.daemon`], opts.env, 'launchctl kickstart')
    } else {
      await runOrFail(opts.exec, 'sc.exe', ['stop', 'da-mcp'], opts.env, 'sc stop')
      await runOrFail(opts.exec, 'sc.exe', ['start', 'da-mcp'], opts.env, 'sc start')
    }
    return { attempted: true, ok: true, detail: `da-mcp service restarted via ${platform} supervisor.` }
  } catch (err) {
    return { attempted: true, ok: false, detail: `restart failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

async function isServiceInstalled(exec: ExecFn, platform: ServicePlatform, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (platform === 'linux') {
    const res = await exec('systemctl', ['--user', 'is-enabled', 'da-mcp.service'], { env })
    return res.code === 0
  }
  if (platform === 'darwin') {
    const res = await exec('launchctl', ['list'], { env })
    return res.stdout.includes('com.da-mcp.daemon')
  }
  const res = await exec('sc.exe', ['query', 'da-mcp'], { env })
  return res.code === 0
}

export function makeInstallRunner(): (opts: InstallServiceOptions) => Promise<InstallServiceResult> {
  const exec = defaultExec()
  return (opts) => installService({ ...opts, exec })
}