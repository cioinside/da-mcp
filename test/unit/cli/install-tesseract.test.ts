import { describe, it, expect } from 'vitest'
import {
  runInstallTesseract,
  type InstallTesseractOptions,
} from '../../../src/cli/install-tesseract.js'
import type { ExecFn } from '../../../src/cli/exec.js'

interface FakeExec extends ExecFn {
  calls: { cmd: string; args: readonly string[] }[]
  setScenario(s: 'has-tesseract' | 'no-tesseract' | 'winget-ok' | 'winget-fail' | 'choco-ok' | 'choco-fail' | 'no-pkg-mgr' | 'admin' | 'no-admin'): void
}

function makeFakeExec(): FakeExec {
  const calls: { cmd: string; args: readonly string[] }[] = []
  let scenario: string = 'no-tesseract'
  const exec: FakeExec = ((cmd: string, args: readonly string[]) => {
    calls.push({ cmd, args })
    if (cmd === 'tesseract' && args[0] === '--version') {
      return Promise.resolve({ stdout: '', stderr: '', code: scenario === 'has-tesseract' ? 0 : 1 })
    }
    if (cmd === 'winget' && args[0] === '--version') {
      return Promise.resolve({ stdout: '', stderr: '', code: scenario === 'winget-ok' || scenario === 'winget-fail' ? 0 : 1 })
    }
    if (cmd === 'choco' && args[0] === '--version') {
      return Promise.resolve({ stdout: '', stderr: '', code: scenario === 'choco-ok' || scenario === 'choco-fail' ? 0 : 1 })
    }
    if (cmd === 'powershell') {
      if (scenario === 'admin') return Promise.resolve({ stdout: '', stderr: '', code: 0 })
      if (scenario === 'no-admin') return Promise.resolve({ stdout: '', stderr: '', code: 1 })
    }
    if (cmd === 'winget' && args[0] === 'install') {
      if (scenario === 'winget-fail') return Promise.resolve({ stdout: '', stderr: 'package not found', code: 1 })
      return Promise.resolve({ stdout: 'ok', stderr: '', code: 0 })
    }
    if (cmd === 'choco' && args[0] === 'install') {
      if (scenario === 'choco-fail') return Promise.resolve({ stdout: '', stderr: 'access denied', code: 1 })
      return Promise.resolve({ stdout: 'ok', stderr: '', code: 0 })
    }
    if (cmd === 'powershell' && args.includes('-Command') && String(args[args.length - 1] ?? '').startsWith('Start-Process')) {
      return Promise.resolve({ stdout: '', stderr: '', code: 0 })
    }
    return Promise.resolve({ stdout: '', stderr: '', code: scenario === 'no-pkg-mgr' ? 1 : 0 })
  }) as FakeExec
  exec.calls = calls
  exec.setScenario = (s) => { scenario = s }
  return exec
}

const baseOpts = (overrides: Partial<InstallTesseractOptions> = {}): InstallTesseractOptions => ({
  exec: makeFakeExec(),
  log: () => {},
  platform: 'win32',
  execPath: 'C:\\Users\\test\\da-mcp.exe',
  extraArgs: [],
  ...overrides,
})

describe('runInstallTesseract', () => {
  it('throws UNSUPPORTED_PLATFORM on linux', async () => {
    await expect(runInstallTesseract(baseOpts({ platform: 'linux' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    })
  })

  it('throws UNSUPPORTED_PLATFORM on darwin', async () => {
    await expect(runInstallTesseract(baseOpts({ platform: 'darwin' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_PLATFORM',
    })
  })

  it('returns alreadyInstalled when tesseract is on PATH', async () => {
    const exec = makeFakeExec()
    exec.setScenario('has-tesseract')
    const r = await runInstallTesseract(baseOpts({ exec }))
    expect(r.alreadyInstalled).toBe(true)
    expect(r.installed).toBe(true)
    expect(r.elevated).toBe(false)
    expect(r.tesseractPath).toBe('tesseract')
  })

  it('relaunches elevated when not admin, then returns elevated=true', async () => {
    const exec = makeFakeExec()
    exec.setScenario('no-admin')
    let relaunched: readonly string[] | null = null
    const r = await runInstallTesseract(baseOpts({
      exec,
      relaunchElevated: async (args) => { relaunched = args },
    }))
    expect(r.elevated).toBe(true)
    expect(r.installed).toBe(false)
    expect(relaunched).toEqual(['install-tesseract'])
  })

  it('installs via winget when admin and winget present', async () => {
    const exec = makeFakeExec()
    exec.setScenario('winget-ok')
    const r = await runInstallTesseract(baseOpts({ exec }))
    expect(r.installed).toBe(true)
    expect(r.alreadyInstalled).toBe(false)
    expect(r.elevated).toBe(false)
    expect(r.packageManager).toBe('winget')
    const wingetCall = exec.calls.find((c) => c.cmd === 'winget' && c.args[0] === 'install')
    expect(wingetCall).toBeDefined()
    expect(wingetCall?.args).toContain('UB-Mannheim.TesseractOCR')
    expect(wingetCall?.args).toContain('--accept-package-agreements')
    expect(wingetCall?.args).toContain('--silent')
  })

  it('falls back to choco when admin, no winget, choco present', async () => {
    const exec = makeFakeExec()
    exec.setScenario('choco-ok')
    const r = await runInstallTesseract(baseOpts({ exec }))
    expect(r.installed).toBe(true)
    expect(r.packageManager).toBe('choco')
    const chocoCall = exec.calls.find((c) => c.cmd === 'choco' && c.args[0] === 'install')
    expect(chocoCall).toBeDefined()
    expect(chocoCall?.args).toContain('tesseract')
    expect(chocoCall?.args).toContain('-y')
  })

  it('prefers winget over choco when both present', async () => {
    const exec = makeFakeExec()
    exec.setScenario('winget-ok')
    const r = await runInstallTesseract(baseOpts({ exec }))
    expect(r.packageManager).toBe('winget')
    expect(exec.calls.some((c) => c.cmd === 'choco')).toBe(false)
  })

  it('throws NATIVE_FAILED when winget install exits non-zero', async () => {
    const exec = makeFakeExec()
    exec.setScenario('winget-fail')
    await expect(runInstallTesseract(baseOpts({ exec }))).rejects.toMatchObject({
      code: 'NATIVE_FAILED',
    })
  })

  it('throws NATIVE_FAILED when choco install exits non-zero', async () => {
    const exec = makeFakeExec()
    exec.setScenario('choco-fail')
    await expect(runInstallTesseract(baseOpts({ exec }))).rejects.toMatchObject({
      code: 'NATIVE_FAILED',
    })
  })

  it('throws NATIVE_MISSING when neither winget nor choco present', async () => {
    const exec = makeFakeExec()
    exec.setScenario('no-pkg-mgr')
    await expect(runInstallTesseract(baseOpts({
      exec,
      isAdmin: async () => true,
    }))).rejects.toMatchObject({
      code: 'NATIVE_MISSING',
    })
  })

  it('passes extraArgs through to relaunchElevated', async () => {
    const exec = makeFakeExec()
    exec.setScenario('no-admin')
    let relaunched: readonly string[] | null = null
    await runInstallTesseract(baseOpts({
      exec,
      extraArgs: ['--foo', '--bar'],
      relaunchElevated: async (args) => { relaunched = args },
    }))
    expect(relaunched).toEqual(['install-tesseract', '--foo', '--bar'])
  })

  it('uses defaultRelaunchElevated when relaunchElevated not injected', async () => {
    const exec = makeFakeExec()
    exec.setScenario('no-admin')
    const r = await runInstallTesseract(baseOpts({ exec }))
    expect(r.elevated).toBe(true)
    const psCalls = exec.calls.filter((c) => c.cmd === 'powershell' && String(c.args[c.args.length - 1] ?? '').startsWith('Start-Process'))
    expect(psCalls.length).toBeGreaterThan(0)
  })
})