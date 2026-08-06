import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { installService, uninstallService, attemptServiceRestart, type InstallServiceOptions } from '../../../src/cli/install-service.js'
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecFn } from '../../../src/cli/exec.js'

interface MockExecCall { cmd: string; args: readonly string[]; cwd?: string }
function makeExec(scenario: 'linux' | 'darwin' | 'win32'): { exec: ExecFn; calls: MockExecCall[] } {
  const calls: MockExecCall[] = []
  const exec: ExecFn = async (cmd, args) => {
    calls.push({ cmd, args })
    return { stdout: '', stderr: '', code: 0 }
  }
  void scenario
  return { exec, calls }
}

function mkProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'da-mcp-install-test-'))
  for (const sub of ['scripts/systemd', 'scripts/launchd', 'scripts/windows']) {
    mkdirSync(join(root, sub), { recursive: true })
    writeFileSync(join(root, sub, '.keep'), '')
  }
  // Pre-populate templates so install doesn't fail on readFileSync.
  writeFileSync(join(root, 'scripts/systemd/da-mcp.service'),
    '[Unit]\nDescription=test\nExecStart={{nodePath}} {{projectRoot}}/dist/x\nEnvironment=DA_MCP_TRANSPORT={{transport}}\n[Install]\nWantedBy=default.target\n')
  writeFileSync(join(root, 'scripts/launchd/com.da-mcp.daemon.plist'),
    '<?xml version="1.0"?>\n<plist><dict><key>ProgramArguments</key>' +
    '<array><string>{{nodePath}}</string><string>{{projectRoot}}/dist/x</string></array>' +
    '<key>EnvironmentVariables</key><dict><key>DA_MCP_TRANSPORT</key><string>{{transport}}</string></dict>' +
    '</dict></plist>')
  writeFileSync(join(root, 'scripts/windows/da-mcp-service.ps1'), "# ps1 placeholder\n")
  return root
}

const baseOpts = (overrides: Partial<InstallServiceOptions> = {}): InstallServiceOptions => ({
  projectRoot: '',
  exec: (async () => ({ stdout: '', stderr: '', code: 0 })) as ExecFn,
  env: {},
  log: () => {},
  home: '/home/alice',
  uid: 1000,
  user: 'alice',
  nodePath: '/usr/bin/node',
  ...overrides,
})

describe('installService — linux', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('writes ~/.config/systemd/user/da-mcp.service with rendered template', async () => {
    const { exec, calls } = makeExec('linux')
    const res = await installService(baseOpts({ projectRoot: root, exec, platform: 'linux' }))

    expect(res.platform).toBe('linux')
    expect(res.installed).toBe(true)
    expect(res.targetPath).toBe('/home/alice/.config/systemd/user/da-mcp.service')

    const written = existsSync(res.targetPath)
    expect(written).toBe(true)
    const content = readFileSync(res.targetPath, 'utf8')
    expect(content).toContain('/usr/bin/node')
    expect(content).toContain(`${root}/dist/x`)
    expect(content).toMatch(/Environment=DA_MCP_TRANSPORT=http/)

    const supervisors = calls.filter((c) => c.cmd === 'systemctl').map((c) => c.args.join(' '))
    expect(supervisors).toContain('--user daemon-reload')
    expect(supervisors).toContain('--user enable da-mcp.service')
    expect(supervisors).toContain('--user start da-mcp.service')
  })
})

describe('installService — darwin', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('writes ~/Library/LaunchAgents/com.da-mcp.daemon.plist and runs launchctl load -w', async () => {
    const { exec, calls } = makeExec('darwin')
    const res = await installService(baseOpts({
      projectRoot: root,
      exec,
      platform: 'darwin',
      home: '/Users/alice',
    }))

    expect(res.platform).toBe('darwin')
    expect(res.targetPath).toBe('/Users/alice/Library/LaunchAgents/com.da-mcp.daemon.plist')

    const content = readFileSync(res.targetPath, 'utf8')
    expect(content).toContain('<string>/usr/bin/node</string>')
    expect(content).toContain(`${root}/dist/x`)

    const lc = calls.filter((c) => c.cmd === 'launchctl').map((c) => c.args.join(' '))
    expect(lc).toContain(`load -w ${res.targetPath}`)
  })
})

describe('installService — win32', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('invokes PowerShell + da-mcp-service.ps1 with -Action Install and forwards env vars', async () => {
    const { exec, calls } = makeExec('win32')
    const res = await installService(baseOpts({
      projectRoot: root,
      exec,
      platform: 'win32',
      home: 'C:\\Users\\alice',
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      env: { SystemRoot: 'C:\\Windows' },
    }))

    expect(res.platform).toBe('win32')
    expect(res.installed).toBe(true)

    const psCalls = calls.filter((c) => c.cmd.endsWith('powershell.exe')).map((c) => c.args.join(' '))
    expect(psCalls.length).toBeGreaterThan(0)
    const args0 = calls.filter((c) => c.cmd.endsWith('powershell.exe'))[0]?.args ?? []
    expect(args0).toContain('-NoProfile')
    expect(args0).toContain('-Action')
    expect(args0).toContain('Install')
  })
})

describe('installService — error path', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('propagates systemctl failure as DaMcpError(NATIVE_FAILED)', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'systemctl' && args.includes('daemon-reload')) {
        return { stdout: '', stderr: 'unit not found', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    await expect(installService(baseOpts({ projectRoot: root, exec, platform: 'linux' })))
      .rejects.toMatchObject({ code: 'NATIVE_FAILED', message: expect.stringMatching(/daemon-reload/) })
  })

  it('throws DaMcpError(PLATFORM_INIT_FAILED) when platform override is unsupported', async () => {
    const { exec } = makeExec('linux')
    await expect(installService(baseOpts({ projectRoot: root, exec, platform: 'unknown' as 'linux' })))
      .rejects.toMatchObject({ code: 'PLATFORM_INIT_FAILED' })
  })
})

describe('uninstallService', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('runs the right supervisor command per platform (linux/darwin/win32)', async () => {
    for (const [plat, supervisor, expected] of [
      ['linux', 'systemctl', '--user disable --now da-mcp.service'],
      ['darwin', 'launchctl', 'unload -w /Users/alice/Library/LaunchAgents/com.da-mcp.daemon.plist'],
    ] as const) {
      const { exec, calls } = makeExec(plat)
      const res = await uninstallService(baseOpts({
        projectRoot: root, exec, platform: plat,
        home: '/Users/alice',
      }))
      expect(res.installed).toBe(false)
      const cmds = calls.filter((c) => c.cmd === supervisor).map((c) => c.args.join(' '))
      expect(cmds.some((s) => s === expected)).toBe(true)
    }
  })

  it('on win32 invokes PowerShell with -Action Uninstall', async () => {
    const { exec, calls } = makeExec('win32')
    await uninstallService(baseOpts({
      projectRoot: root, exec, platform: 'win32', home: 'C:\\Users\\alice',
      env: { SystemRoot: 'C:\\Windows' },
    }))
    const ps = calls.filter((c) => c.cmd.endsWith('powershell.exe'))
    expect(ps.length).toBeGreaterThan(0)
    expect(ps[0]?.args).toContain('Uninstall')
  })
})

describe('attemptServiceRestart', () => {
  let root: string
  beforeEach(() => { root = mkProject() })
  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('returns skipped when the service is not installed', async () => {
    const exec: ExecFn = async (cmd) => {
      if (cmd === 'systemctl') return { stdout: 'disabled\n', stderr: '', code: 1 }
      if (cmd === 'launchctl') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'sc.exe') return { stdout: '', stderr: '', code: 1 }
      return { stdout: '', stderr: '', code: 0 }
    }
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'linux' })
    expect(r.attempted).toBe(false)
    expect(r.detail).toMatch(/no da-mcp system service installed/)
  })

  it('returns ok when the service IS installed and restart succeeds', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'systemctl' && args.includes('is-enabled')) return { stdout: 'enabled\n', stderr: '', code: 0 }
      if (cmd === 'systemctl' && args.includes('restart')) return { stdout: '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    }
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'linux' })
    expect(r.attempted).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('returns failed when the restart command exits non-zero', async () => {
    const exec: ExecFn = async (cmd, args) => {
      if (cmd === 'systemctl' && args.includes('is-enabled')) return { stdout: 'enabled\n', stderr: '', code: 0 }
      if (cmd === 'systemctl' && args.includes('restart')) {
        return { stdout: '', stderr: 'unit not found', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'linux' })
    expect(r.attempted).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.detail).toMatch(/restart failed/)
  })

  it('returns skipped on unknown platform', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: '', code: 0 })
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'unknown' })
    expect(r.attempted).toBe(false)
    expect(r.detail).toMatch(/unknown platform/)
  })

  it('uses sc stop+start on win32', async () => {
    const seen: string[] = []
    const exec: ExecFn = async (cmd, args) => {
      seen.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'sc.exe' && args[0] === 'query') return { stdout: '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    }
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'win32' })
    expect(r.attempted).toBe(true)
    expect(seen.some((s) => s.includes('stop da-mcp'))).toBe(true)
    expect(seen.some((s) => s.includes('start da-mcp'))).toBe(true)
  })

  it('uses launchctl kickstart on darwin', async () => {
    const seen: string[] = []
    const exec: ExecFn = async (cmd, args) => {
      seen.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'launchctl' && args[0] === 'list') return { stdout: 'com.da-mcp.daemon', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    }
    const r = await attemptServiceRestart({ projectRoot: root, exec, env: {}, platform: 'darwin' })
    expect(r.attempted).toBe(true)
    expect(seen.some((s) => s.startsWith('launchctl kickstart'))).toBe(true)
  })
})