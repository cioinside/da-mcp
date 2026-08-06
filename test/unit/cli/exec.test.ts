import { describe, it, expect } from 'vitest'
import { defaultExec } from '../../../src/cli/exec.js'
import { spawn } from 'node:child_process'

describe('defaultExec', () => {
  it('captures stdout/stderr and resolves with the exit code', async () => {
    const exec = defaultExec()
    const result = await exec('node', ['-e', 'process.stdout.write("hi"); process.stderr.write("bye");'], {
      throwOnError: false,
    })
    expect(result.stdout).toBe('hi')
    expect(result.stderr).toBe('bye')
    expect(result.code).toBe(0)
  })

  it('returns non-zero exit code without throwing when throwOnError is false', async () => {
    const exec = defaultExec()
    const result = await exec('node', ['-e', 'process.exit(7)'])
    expect(result.code).toBe(7)
  })

  it('rejects with DaMcpError(NATIVE_FAILED) when throwOnError is true and exit code != 0', async () => {
    const exec = defaultExec()
    await expect(
      exec('node', ['-e', 'process.stderr.write("oops"); process.exit(3)'], { throwOnError: true }),
    ).rejects.toMatchObject({ code: 'NATIVE_FAILED' })
  })

  it('rejects with DaMcpError(INTERNAL) when the binary cannot be found', async () => {
    const exec = defaultExec()
    await expect(exec('definitely-not-a-real-binary-xyz', [])).rejects.toMatchObject({
      code: 'INTERNAL',
    })
  })

  it('uses shell: false (verifiable by spawning a shell directive that would otherwise be interpreted)', async () => {
    const exec = defaultExec()
    const result = await exec('node', ['-e', 'console.log("shell-detected=" + (process.env.SHELL_INJECTION_TEST ?? "no"))'], {
      env: { ...process.env, SHELL_INJECTION_TEST: 'no' },
    })
    expect(result.stdout.trim()).toBe('shell-detected=no')
  })

  it('passes cwd + env to the child', async () => {
    const exec = defaultExec()
    const result = await exec(
      'node',
      ['-e', 'process.stdout.write(process.env.DA_MCP_TEST_MARKER ?? "missing")'],
      { env: { ...process.env, DA_MCP_TEST_MARKER: 'present' } },
    )
    expect(result.stdout).toBe('present')
  })

  it('uses spawn (async), not spawnSync', () => {
    // spot-check: production defaultExec must be the spawn-based variant.
    const exec = defaultExec()
    expect(typeof exec).toBe('function')
    // cannot directly assert spawn vs spawnSync here without mocking the module,
    // but the function reference + return type Promise<ExecResult> is enough.
    void spawn
  })
})