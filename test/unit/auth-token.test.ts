import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateToken,
  getTokenPath,
  ensureTokenDir,
  saveToken,
  loadToken,
  loadOrCreateToken,
  regenerateToken,
  verifyToken,
  getServerUrl,
} from '../../src/auth/token.js'
import { DaMcpError } from '../../src/errors.js'

let workspace: string
const SAVED_ENV: Record<string, string | undefined> = {}

function saveEnv(key: string): void {
  SAVED_ENV[key] = process.env[key]
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'da-mcp-auth-'))
  for (const k of [
    'DA_MCP_TOKEN_PATH',
    'XDG_CONFIG_HOME',
    'APPDATA',
    'HOME',
    'USERPROFILE',
  ]) {
    saveEnv(k)
    delete process.env[k]
  }
})

afterEach(async () => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await rm(workspace, { recursive: true, force: true })
})

describe('generateToken', () => {
  it('returns a 43-char base64url string', () => {
    const t = generateToken()
    expect(t).toHaveLength(43)
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('returns distinct tokens on each call', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
  })

  it('respects custom byte length', () => {
    const t = generateToken(16)
    expect(t).toHaveLength(22)
  })
})

describe('getTokenPath', () => {
  it('uses override argument when provided', () => {
    const p = getTokenPath('/custom/path/token')
    expect(p).toBe('/custom/path/token')
  })

  it('uses DA_MCP_TOKEN_PATH env when no override', () => {
    process.env['DA_MCP_TOKEN_PATH'] = '/env/path/token'
    expect(getTokenPath()).toBe('/env/path/token')
  })

  it('prefers override over env', () => {
    process.env['DA_MCP_TOKEN_PATH'] = '/env/path/token'
    expect(getTokenPath('/override/token')).toBe('/override/token')
  })

  it('uses XDG_CONFIG_HOME on linux', () => {
    process.env['XDG_CONFIG_HOME'] = '/xdg/config'
    const p = getTokenPath()
    if (process.platform === 'linux') {
      expect(p).toBe('/xdg/config/da-mcp/token')
    }
  })
})

describe('ensureTokenDir / saveToken / loadToken', () => {
  it('round-trips a token through disk', async () => {
    const path = join(workspace, 'sub/dir/token')
    await ensureTokenDir(path)
    await saveToken('hello-token', path)
    expect(await loadToken(path)).toBe('hello-token')
  })

  it('loadToken throws DaMcpError(ENOENT) for missing file', async () => {
    const path = join(workspace, 'missing/token')
    let caught: unknown = undefined
    try {
      await loadToken(path)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DaMcpError)
    if (caught instanceof DaMcpError) {
      expect(caught.code).toBe('ENOENT')
    }
  })

  it('writes token file with 0o600 on unix', async () => {
    if (process.platform === 'win32') return
    const path = join(workspace, 'token')
    await saveToken('secret', path)
    const st = await stat(path)
    expect((st.mode & 0o777).toString(8)).toBe('600')
  })
})

describe('loadOrCreateToken', () => {
  it('creates a new token if none exists', async () => {
    const path = join(workspace, 'seed', 'token')
    const t = await loadOrCreateToken(path)
    expect(t).toHaveLength(43)
    expect(await readFile(path, 'utf8')).toBe(t)
  })

  it('returns existing token if file present', async () => {
    const path = join(workspace, 'token')
    await saveToken('existing-token', path)
    expect(await loadOrCreateToken(path)).toBe('existing-token')
  })
})

describe('regenerateToken', () => {
  it('overwrites existing token with a fresh 43-char one', async () => {
    const path = join(workspace, 'token')
    await saveToken('old-token', path)
    const t = await regenerateToken(path)
    expect(t).toHaveLength(43)
    expect(await loadToken(path)).toBe(t)
  })
})

describe('verifyToken', () => {
  it('returns true for equal tokens', () => {
    expect(verifyToken('abc', 'abc')).toBe(true)
  })

  it('returns false for unequal same-length tokens', () => {
    expect(verifyToken('abc', 'abd')).toBe(false)
  })

  it('returns false for length mismatch', () => {
    expect(verifyToken('short', 'much-longer')).toBe(false)
  })
})

describe('getServerUrl', () => {
  it('formats host:port/token', () => {
    expect(getServerUrl('abc', '127.0.0.1', 3000)).toBe('http://127.0.0.1:3000/abc')
  })
})
