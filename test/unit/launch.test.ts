import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { launchProgram, isShellSafe, SIGNAL_EXIT_CODES } from '../../src/launch/launch.js'
import { DaMcpError } from '../../src/errors.js'
import { initConfig, resetConfig } from '../../src/config.js'

// ---- helpers ---------------------------------------------------------------

/** Run `fn` and return the caught error; fail the test if it resolves. */
async function expectThrows(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (e) {
    return e
  }
  throw new Error('expected the call to reject, but it resolved')
}

/** Assert a captured error is a DaMcpError with the expected code. */
function assertCode(err: unknown, code: string): void {
  expect(DaMcpError.is(err)).toBe(true)
  if (DaMcpError.is(err)) {
    expect(err.code).toBe(code)
  }
}

// ---- env save/restore ------------------------------------------------------

let savedTestMode: string | undefined

beforeEach(() => {
  savedTestMode = process.env['DA_MCP_TEST_MODE']
  process.env['DA_MCP_TEST_MODE'] = 'real'
  initConfig(process.env)
})

afterEach(() => {
  if (savedTestMode === undefined) {
    delete process.env['DA_MCP_TEST_MODE']
  } else {
    process.env['DA_MCP_TEST_MODE'] = savedTestMode
  }
  resetConfig()
})

// ---- isShellSafe -----------------------------------------------------------

describe('isShellSafe', () => {
  it('returns true for alphanumerics + dashes + underscores + dots', () => {
    expect(isShellSafe('hello-world_1.0')).toBe(true)
  })

  it('returns false for semicolon', () => {
    expect(isShellSafe('hello;rm')).toBe(false)
  })

  it('returns false for backtick', () => {
    expect(isShellSafe('`whoami`')).toBe(false)
  })

  it('returns false for dollar sign', () => {
    expect(isShellSafe('$HOME')).toBe(false)
  })

  it('returns false for pipe', () => {
    expect(isShellSafe('a|b')).toBe(false)
  })

  it('returns false for newline', () => {
    expect(isShellSafe('a\nb')).toBe(false)
  })

  it('returns true for empty string (no metachars to find)', () => {
    expect(isShellSafe('')).toBe(true)
  })
})

// ---- launchProgram — argv validation (no spawn) -----------------------------

describe('launchProgram — argv validation', () => {
  it('throws INVALID_ARGUMENT for empty argv', async () => {
    const err = await expectThrows(() => launchProgram([]))
    assertCode(err, 'INVALID_ARGUMENT')
  })

  it('throws INVALID_ARGUMENT for argv[0] empty string', async () => {
    const err = await expectThrows(() => launchProgram(['']))
    assertCode(err, 'INVALID_ARGUMENT')
  })

  it('throws SHELL_INJECTION_DETECTED before any spawn (semicolon)', async () => {
    const err = await expectThrows(() =>
      launchProgram(['echo', 'hello; rm -rf /']),
    )
    assertCode(err, 'SHELL_INJECTION_DETECTED')
  })

  it('throws SHELL_INJECTION_DETECTED for backtick arg', async () => {
    const err = await expectThrows(() => launchProgram(['echo', '`whoami`']))
    assertCode(err, 'SHELL_INJECTION_DETECTED')
  })

  it('throws SHELL_INJECTION_DETECTED for $VAR arg', async () => {
    const err = await expectThrows(() => launchProgram(['echo', '$HOME']))
    assertCode(err, 'SHELL_INJECTION_DETECTED')
  })
})

// ---- launchProgram — PATH resolution / actual spawn -------------------------

describe('launchProgram — PATH resolution', () => {
  it('returns SpawnHandle with pid>0 and exited=0 for echo (real mode)', async () => {
    const which = spawnSync('which', ['echo'], {
      shell: false,
      encoding: 'utf8',
    })
    expect(which.status).toBe(0)
    const handle = await launchProgram(['echo', 'hello'])
    expect(typeof handle.pid).toBe('number')
    expect(handle.pid).not.toBeNull()
    expect(handle.pid).toBeGreaterThan(0)
    const code = await handle.exited
    expect(typeof code).toBe('number')
    expect(code).toBe(0)
  })

  it('throws ENOENT for a non-existent program', async () => {
    const err = await expectThrows(() =>
      launchProgram(['definitely-not-a-real-binary-xyz123']),
    )
    assertCode(err, 'ENOENT')
  })

  it('with absolute path /bin/echo, skips PATH lookup', async () => {
    expect(existsSync('/bin/echo')).toBe(true)
    const handle = await launchProgram(['/bin/echo', 'test'])
    expect(handle.pid).not.toBeNull()
    expect(typeof handle.pid).toBe('number')
    expect(handle.pid).toBeGreaterThan(0)
    const code = await handle.exited
    expect(code).toBe(0)
  })

  it('throws ENOENT for non-executable absolute path', async () => {
    const err = await expectThrows(() => launchProgram(['/etc/passwd']))
    assertCode(err, 'ENOENT')
  })
})

// ---- launchProgram — handle lifecycle --------------------------------------

describe('launchProgram — handle.kill()', () => {
  it('sets the killed flag and lets exited resolve', async () => {
    const handle = await launchProgram(['echo', 'hello'])
    expect(handle.killed).toBe(false)
    handle.kill()
    expect(handle.killed).toBe(true)
    const code = await handle.exited
    expect(typeof code).toBe('number')
  })
})

describe('SIGNAL_EXIT_CODES', () => {
  it('exposes the canonical POSIX signal exit codes (128 + N)', () => {
    expect(SIGNAL_EXIT_CODES.SIGTERM).toBe(143)
    expect(SIGNAL_EXIT_CODES.SIGINT).toBe(130)
    expect(SIGNAL_EXIT_CODES.SIGHUP).toBe(129)
    expect(SIGNAL_EXIT_CODES.SIGKILL).toBe(137)
    expect(SIGNAL_EXIT_CODES.SIGQUIT).toBe(131)
    expect(SIGNAL_EXIT_CODES.SIGABRT).toBe(134)
  })
})

describe('launchProgram — timeout-induced termination', () => {
  it('reports SIGTERM exit code (143) and sets killed flag when timeout fires', async () => {
    const handle = await launchProgram(['sleep', '5'], { timeoutMs: 100 })
    expect(handle.pid).not.toBeNull()
    expect(typeof handle.pid).toBe('number')
    const code = await handle.exited
    expect(code).toBe(143)
    expect(handle.killed).toBe(true)
  })
})
