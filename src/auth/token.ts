/**
 * Token generation, persistence, and verification for the HTTP transport.
 *
 * Tokens are 32 random bytes encoded as base64url (43 chars, no padding).
 * They live on disk at an OS-specific path; the directory is created with
 * 0700 perms and the file with 0600 perms on Unix. On Windows the mode
 * argument is accepted by Node's fs but has no effect (ACL-only).
 *
 * Verification is constant-time on equal-length inputs. Length mismatch
 * short-circuits — tokens are fixed length (43 chars) so leaking length
 * reveals nothing, and the early return avoids the crash on
 * `timingSafeEqual` unequal-length buffers.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { DaMcpError } from '../errors.js'

const DEFAULT_TOKEN_BYTES = 32
const UNIX_DIR_MODE = 0o700
const UNIX_FILE_MODE = 0o600

export function generateToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url')
}

export function getTokenPath(override?: string): string {
  if (override !== undefined && override.length > 0) return override
  const envOverride = process.env['DA_MCP_TOKEN_PATH']
  if (envOverride !== undefined && envOverride.length > 0) return envOverride
  const home = homedir()
  switch (platform()) {
    case 'linux': {
      const base =
        process.env['XDG_CONFIG_HOME'] !== undefined &&
        process.env['XDG_CONFIG_HOME'].length > 0
          ? process.env['XDG_CONFIG_HOME']
          : join(home, '.config')
      return join(base, 'da-mcp', 'token')
    }
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'da-mcp', 'token')
    case 'win32': {
      const appData =
        process.env['APPDATA'] !== undefined && process.env['APPDATA'].length > 0
          ? process.env['APPDATA']
          : home
      return join(appData, 'da-mcp', 'token')
    }
    default:
      return join(home, '.da-mcp', 'token')
  }
}

export async function ensureTokenDir(tokenPath: string): Promise<void> {
  const dir = dirname(tokenPath)
  await mkdir(dir, { recursive: true, mode: UNIX_DIR_MODE })
}

export async function saveToken(token: string, tokenPath: string): Promise<void> {
  await ensureTokenDir(tokenPath)
  await writeFile(tokenPath, token, { mode: UNIX_FILE_MODE })
}

export async function loadToken(tokenPath: string): Promise<string> {
  let raw: string
  try {
    raw = await readFile(tokenPath, 'utf8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DaMcpError('ENOENT', `token file not found: ${tokenPath}`)
    }
    throw err
  }
  return raw.trim()
}

export async function loadOrCreateToken(tokenPath?: string): Promise<string> {
  const path = getTokenPath(tokenPath)
  try {
    return await loadToken(path)
  } catch (err: unknown) {
    if (err instanceof DaMcpError && err.code === 'ENOENT') {
      const token = generateToken()
      await saveToken(token, path)
      return token
    }
    throw err
  }
}

export async function regenerateToken(tokenPath?: string): Promise<string> {
  const path = getTokenPath(tokenPath)
  const token = generateToken()
  await saveToken(token, path)
  return token
}

export function verifyToken(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false
  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  return timingSafeEqual(a, b)
}

export function getServerUrl(token: string, host: string, port: number): string {
  return `http://${host}:${port}/${token}`
}
