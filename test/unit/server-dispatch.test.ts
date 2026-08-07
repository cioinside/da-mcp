/**
 * Regression test for v1.0.3 bug #23.
 *
 * v1.0.3 used `process.execPath === process.argv[1]` to detect binary
 * (Node SEA) installs. That check is FALSE in SEA mode because
 * `process.argv[1]` is the first user argument (e.g. `"upgrade"`), not
 * the binary path. The fallback to `runSourceUpgrade` then ran
 * `git rev-parse` against a non-git directory and crashed with exit 128.
 *
 * The fix detects SEA via the executable basename: `node`/`node.exe`/
 * `node-<version>` for source mode, anything else (e.g. `da-mcp.exe`)
 * for SEA. These tests pin the detection rule so future renames don't
 * silently regress it.
 */
import { describe, it, expect } from 'vitest'
import { isBinaryExecName } from '../../src/server-dispatch.js'

describe('isBinaryExecName — source-mode basenames', () => {
  it('detects node (POSIX)', () => {
    expect(isBinaryExecName('node')).toBe(false)
  })

  it('detects node.exe (Windows)', () => {
    expect(isBinaryExecName('node.exe')).toBe(false)
  })

  it('detects versioned POSIX node binary', () => {
    expect(isBinaryExecName('node-22.0.0')).toBe(false)
  })

  it('detects versioned Windows node binary', () => {
    expect(isBinaryExecName('node-22.0.0.exe')).toBe(false)
  })

  it('detects .nvmrc-managed node shim', () => {
    expect(isBinaryExecName('node-v22.10.0')).toBe(false)
  })

  it('is case-insensitive (NODE on Windows still means source)', () => {
    expect(isBinaryExecName('NODE.EXE')).toBe(false)
  })
})

describe('isBinaryExecName — SEA-mode basenames', () => {
  it('detects da-mcp.exe (Windows single-binary release)', () => {
    expect(isBinaryExecName('da-mcp.exe')).toBe(true)
  })

  it('detects da-mcp (POSIX single-binary release)', () => {
    expect(isBinaryExecName('da-mcp')).toBe(true)
  })

  it('detects custom SEA host binary name', () => {
    expect(isBinaryExecName('my-tool-linux-x64')).toBe(true)
  })

  it('is case-insensitive (DA-MCP.EXE still means binary)', () => {
    expect(isBinaryExecName('DA-MCP.EXE')).toBe(true)
  })
})

describe('isBinaryExecName — argv[1] would have given wrong answers', () => {
  // Pinning the v1.0.3 failure mode: if anyone refactors back to the
  // execPath/argv[1] equality, these basenames are the SEA-side inputs
  // that the old check silently rejected.
  it('host basename is not the same as the user argument', () => {
    const host = 'da-mcp.exe'
    const arg = 'upgrade'
    expect(host).not.toBe(arg)
    expect(isBinaryExecName(host)).toBe(true)
  })

  it('zero-arg invocation in SEA still detects as binary', () => {
    expect(isBinaryExecName('da-mcp.exe')).toBe(true)
  })

  it('flag-style argv in SEA still detects as binary', () => {
    // argv[1] = '--help', argv[2] = 'foo' — none of these match execName.
    // Detection must NOT depend on argv contents.
    expect(isBinaryExecName('da-mcp.exe')).toBe(true)
  })
})