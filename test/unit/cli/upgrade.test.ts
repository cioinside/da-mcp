import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runUpgrade, type UpgradeOptions } from '../../../src/cli/upgrade.js'
import type { ExecFn } from '../../../src/cli/exec.js'

interface Call { cmd: string; args: readonly string[]; cwd?: string }

function makeExec(plan: Record<string, string>): { exec: ExecFn; calls: Call[] } {
  const calls: Call[] = []
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts?.cwd })
    const key = `${cmd} ${args.join(' ')}`
    const stdout = plan[key] ?? ''
    return { stdout, stderr: '', code: 0 }
  }
  return { exec, calls }
}

const defaultOpts = (overrides: Partial<UpgradeOptions> = {}): UpgradeOptions => ({
  projectRoot: '/fake/repo',
  force: false,
  exec: makeExec({}).exec,
  env: {},
  log: () => {},
  ...overrides,
})

describe('runUpgrade', () => {
  let exec: ExecFn
  let calls: Call[]

  beforeEach(() => {
    ({ exec, calls } = makeExec({}))
  })

  it('runs the full pipeline: status → branch → fetch → reset → npm ci/build/typecheck', async () => {
    const plan: Record<string, string> = {
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref HEAD': 'main\n',
      'git rev-parse HEAD': 'aaa\n',
      'git fetch origin main': '',
      'git reset --hard origin/main': '',
    }
    ;({ exec, calls } = makeExec(plan))

    const result = await runUpgrade(defaultOpts({ exec }))

    expect(result.branch).toBe('main')
    expect(result.before).toBe('aaa')
    expect(result.after).toBe('aaa')
    expect(result.changed).toBe(false)
    expect(result.steps).toEqual(['git reset --hard'])

    const seen = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`)
    expect(seen).toContain('git status --porcelain')
    expect(seen).toContain('git fetch origin main')
    expect(seen).toContain('git reset --hard origin/main')
    // No npm steps when before === after.
    expect(seen.find((s) => s.startsWith('npm '))).toBeUndefined()
  })

  it('skips npm pipeline when SHA did not change', async () => {
    const plan: Record<string, string> = {
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref HEAD': 'main',
      'git rev-parse HEAD': 'same',
      'git fetch origin main': '',
      'git reset --hard origin/main': '',
    }
    ;({ exec, calls } = makeExec(plan))

    const r = await runUpgrade(defaultOpts({ exec }))
    expect(r.changed).toBe(false)
    expect(r.steps).toEqual(['git reset --hard'])
  })

  it('runs npm ci + build + typecheck when SHA advances', async () => {
    const plan: Record<string, string> = {
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref HEAD': 'main',
      'git rev-parse HEAD': 'before',
      'git fetch origin main': '',
      'git reset --hard origin/main': '',
    }
    const seen: string[] = []
    exec = async (cmd, args) => {
      seen.push(`${cmd} ${args.join(' ')}`)
      if (cmd === 'git' && args[0] === 'rev-parse') {
        return { stdout: args[1] === '--abbrev-ref' ? 'main' : args[1] === 'HEAD' ? (seen.length <= 5 ? 'before' : 'after') : '', stderr: '', code: 0 }
      }
      if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'reset') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'npm') return { stdout: '', stderr: '', code: 0 }
      return { stdout: '', stderr: '', code: 0 }
    }
    void plan

    const r = await runUpgrade(defaultOpts({ exec }))
    expect(r.changed).toBe(true)
    expect(r.steps).toEqual(['git reset --hard', 'npm ci', 'npm run build', 'npm run typecheck'])
    expect(seen).toContain('npm ci')
    expect(seen).toContain('npm run build')
    expect(seen).toContain('npm run typecheck')
  })

  it('refuses to run on a dirty working tree (without --force)', async () => {
    const { exec: dirtyExec } = makeExec({
      'git status --porcelain': ' M README.md\n',
      'git rev-parse --abbrev-ref HEAD': 'main',
    })
    await expect(runUpgrade(defaultOpts({ exec: dirtyExec }))).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/uncommitted changes/),
    })
  })

  it('--force proceeds despite dirty working tree', async () => {
    const plan: Record<string, string> = {
      'git status --porcelain': ' M README.md',
      'git rev-parse --abbrev-ref HEAD': 'main',
      'git rev-parse HEAD': 'before',
      'git fetch origin main': '',
      'git reset --hard origin/main': '',
    }
    ;({ exec } = makeExec(plan))
    const r = await runUpgrade(defaultOpts({ exec, force: true }))
    expect(r.branch).toBe('main')
  })

  it('rejects on detached HEAD', async () => {
    const { exec: dExec } = makeExec({
      'git status --porcelain': '',
      'git rev-parse --abbrev-ref HEAD': 'HEAD',
    })
    await expect(runUpgrade(defaultOpts({ exec: dExec }))).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/Detached HEAD/),
    })
  })

  it('propagates git fetch failure', async () => {
    const failingExec: ExecFn = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'main', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: 'before', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'fetch') {
        return { stdout: '', stderr: 'connection refused', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    await expect(runUpgrade(defaultOpts({ exec: failingExec }))).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/git fetch failed/),
    })
  })

  it('propagates npm ci failure', async () => {
    const sha = { v: 'before' as string }
    const npmFailExec: ExecFn = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'main', stderr: '', code: 0 }
      if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        const out = sha.v
        if (sha.v === 'before') sha.v = 'after'
        return { stdout: out, stderr: '', code: 0 }
      }
      if (cmd === 'git' && (args[0] === 'fetch' || args[0] === 'reset')) return { stdout: '', stderr: '', code: 0 }
      if (cmd === 'npm' && args[0] === 'ci') {
        return { stdout: '', stderr: 'EUSAGE', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    await expect(runUpgrade(defaultOpts({ exec: npmFailExec }))).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringMatching(/npm ci failed/),
    })
  })

  it('passes cwd and env to npm invocations', async () => {
    const cwdSpy = vi.fn()
    const envSpy = vi.fn()
    const sha = { v: 'before' as string }
    const exec: ExecFn = async (cmd, args, opts) => {
      if (cmd === 'git') {
        if (args[0] === 'status') return { stdout: '', stderr: '', code: 0 }
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return { stdout: 'main', stderr: '', code: 0 }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          const out = sha.v
          if (sha.v === 'before') sha.v = 'after'
          return { stdout: out, stderr: '', code: 0 }
        }
        if (args[0] === 'fetch' || args[0] === 'reset') return { stdout: '', stderr: '', code: 0 }
      }
      if (cmd === 'npm') {
        cwdSpy(opts?.cwd)
        envSpy(opts?.env)
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    }
    await runUpgrade(defaultOpts({ exec, projectRoot: '/custom/root', env: { NODE_ENV: 'test' } }))
    expect(cwdSpy).toHaveBeenCalledWith('/custom/root')
    expect(envSpy).toHaveBeenCalledWith(expect.objectContaining({ NODE_ENV: 'test' }))
  })
})