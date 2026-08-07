import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  runUpgradeBinary,
  expectedAssetName,
  pickAsset,
  type UpgradeBinaryFs,
  type UpgradeBinaryOptions,
} from '../../src/cli/upgrade-binary.js'
import type { ExecFn } from '../../src/cli/exec.js'
import type { ReleaseInfo } from '../../src/github-releases.js'
import { DaMcpError } from '../../src/errors.js'

function makeFs(): { fs: UpgradeBinaryFs; ops: { writes: string[]; renames: Array<[string, string]> } } {
  const ops = { writes: [] as string[], renames: [] as Array<[string, string]> }
  const fs: UpgradeBinaryFs = {
    writeFile: async (path) => { ops.writes.push(path) },
    rename: async (from, to) => { ops.renames.push([from, to]) },
    stat: async (path) => ({ size: 42 }),
  }
  return { fs, ops }
}

function makeExec(responses: Array<{ cmd: string; args: readonly string[]; code: number; stdout?: string }>): ExecFn {
  return async (cmd, args) => {
    for (const r of responses) {
      if (r.cmd === cmd && r.args.length === args.length && r.args.every((a, i) => a === args[i])) {
        return { stdout: r.stdout ?? '', stderr: '', code: r.code }
      }
    }
    return { stdout: '', stderr: '', code: 0 }
  }
}

function makeReleaseJson(
  tag: string,
  size: number,
  bytes: Uint8Array,
  withDigest = true,
): ReleaseInfo {
  const sha = createHash('sha256').update(bytes).digest('hex')
  return {
    tag_name: tag,
    name: tag,
    published_at: '2026-08-07T00:00:00Z',
    html_url: `https://github.com/x/y/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'da-mcp-win32-x64.exe',
        size,
        browser_download_url: 'https://example.com/da-mcp-win32-x64.exe',
        digest: withDigest ? `sha256:${sha}` : null,
      },
    ],
  }
}

function makeFetch(release: ReleaseInfo, bytes: Uint8Array, status = 200): typeof globalThis.fetch {
  return ((url: unknown, _init?: unknown) => {
    const u = String(url)
    if (u.includes('api.github.com')) {
      const body = status === 200 ? JSON.stringify(release) : 'oops'
      return Promise.resolve(new Response(body, { status, statusText: status === 200 ? 'OK' : 'FAIL' }))
    }
    if (status === 200) {
      return Promise.resolve(new Response(bytes, { status, statusText: 'OK' }))
    }
    return Promise.resolve(new Response('oops', { status, statusText: 'FAIL' }))
  }) as typeof globalThis.fetch
}

describe('expectedAssetName', () => {
  it('builds win32-x64.exe', () => {
    expect(expectedAssetName('win32', 'x64')).toBe('da-mcp-win32-x64.exe')
  })

  it('builds linux-arm64 (no extension)', () => {
    expect(expectedAssetName('linux', 'arm64')).toBe('da-mcp-linux-arm64')
  })

  it('builds darwin-x64 (no extension)', () => {
    expect(expectedAssetName('darwin', 'x64')).toBe('da-mcp-darwin-x64')
  })

  it('throws on unsupported arch', () => {
    expect(() => expectedAssetName('win32', 'mips')).toThrow(DaMcpError)
  })
})

describe('pickAsset', () => {
  it('finds a matching asset', () => {
    const release: ReleaseInfo = {
      tag_name: 'v1',
      name: '',
      published_at: '',
      html_url: '',
      draft: false,
      prerelease: false,
      assets: [{ name: 'da-mcp-linux-x64', size: 1, browser_download_url: 'u', digest: null }],
    }
    const a = pickAsset(release, 'da-mcp-linux-x64')
    expect(a.name).toBe('da-mcp-linux-x64')
  })

  it('throws NOT_FOUND when asset missing', () => {
    const release: ReleaseInfo = {
      tag_name: 'v1',
      name: '',
      published_at: '',
      html_url: '',
      draft: false,
      prerelease: false,
      assets: [],
    }
    expect(() => pickAsset(release, 'da-mcp-linux-x64')).toThrow(DaMcpError)
    try {
      pickAsset(release, 'da-mcp-linux-x64')
    } catch (err) {
      expect(DaMcpError.is(err) && err.code === 'NOT_FOUND').toBe(true)
    }
  })
})

describe('runUpgradeBinary', () => {
  const baseOpts = (overrides: Partial<UpgradeBinaryOptions> = {}): UpgradeBinaryOptions => {
    const { fs } = makeFs()
    return {
      repo: 'cioinside/da-mcp',
      currentVersion: '0.1.0',
      execPath: '/usr/local/bin/da-mcp.exe',
      platform: 'win32',
      arch: 'x64',
      force: false,
      exec: makeExec([{ cmd: 'sc.exe', args: ['stop', 'da-mcp'], code: 0 }]),
      fs,
      env: {},
      log: () => {},
      now: () => 1700000000000,
      ...overrides,
    }
  }

  it('downloads, verifies, swaps, restarts service', async () => {
    const bytes = new Uint8Array(Buffer.from('binary-bytes-here', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, bytes)
    const { fs, ops } = makeFs()
    const exec = makeExec([
      { cmd: 'sc.exe', args: ['stop', 'da-mcp'], code: 0 },
      { cmd: 'sc.exe', args: ['start', 'da-mcp'], code: 0 },
    ])
    const result = await runUpgradeBinary(baseOpts({ fs, exec, fetch: makeFetch(release, bytes) }))
    expect(result.changed).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.assetName).toBe('da-mcp-win32-x64.exe')
    expect(result.downloadBytes).toBe(bytes.byteLength)
    expect(result.execPath).toBe('/usr/local/bin/da-mcp.exe')
    expect(result.backupPath).toBe('/usr/local/bin/da-mcp.exe.old.1700000000000')
    expect(result.restart.attempted).toBe(true)
    expect(result.restart.ok).toBe(true)
    expect(ops.writes).toEqual(['/usr/local/bin/da-mcp.exe.new.1700000000000'])
    expect(ops.renames).toEqual([
      ['/usr/local/bin/da-mcp.exe', '/usr/local/bin/da-mcp.exe.old.1700000000000'],
      ['/usr/local/bin/da-mcp.exe.new.1700000000000', '/usr/local/bin/da-mcp.exe'],
    ])
  })

  it('no-ops when current is newer or equal (no force)', async () => {
    const bytes = new Uint8Array(0)
    const release = makeReleaseJson('v1.0.2', 0, bytes)
    const { fs } = makeFs()
    const result = await runUpgradeBinary(baseOpts({
      currentVersion: 'v1.0.5',
      fs,
      fetch: makeFetch(release, bytes),
    }))
    expect(result.changed).toBe(false)
    expect(result.latestVersion).toBe('v1.0.2')
  })

  it('upgrades when force=true even if not newer', async () => {
    const bytes = new Uint8Array(Buffer.from('reinstall', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, bytes)
    const { fs, ops } = makeFs()
    const exec = makeExec([
      { cmd: 'sc.exe', args: ['stop', 'da-mcp'], code: 0 },
      { cmd: 'sc.exe', args: ['start', 'da-mcp'], code: 0 },
    ])
    const result = await runUpgradeBinary(baseOpts({
      currentVersion: 'v1.0.5',
      force: true,
      fs,
      exec,
      fetch: makeFetch(release, bytes),
    }))
    expect(result.changed).toBe(true)
    expect(ops.writes).toHaveLength(1)
  })

  it('throws NATIVE_FAILED on sha256 mismatch (no rename)', async () => {
    const bytes = new Uint8Array(Buffer.from('actual-bytes', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, new Uint8Array(Buffer.from('tampered-bytes', 'utf8')))
    const { fs, ops } = makeFs()
    await expect(runUpgradeBinary(baseOpts({ fs, fetch: makeFetch(release, bytes) })))
      .rejects.toMatchObject({ code: 'NATIVE_FAILED' })
    expect(ops.writes).toEqual([])
    expect(ops.renames).toEqual([])
  })

  it('proceeds with verified=false when no digest present', async () => {
    const bytes = new Uint8Array(Buffer.from('opaque', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, bytes, false)
    const { fs, ops } = makeFs()
    const exec = makeExec([
      { cmd: 'sc.exe', args: ['stop', 'da-mcp'], code: 0 },
      { cmd: 'sc.exe', args: ['start', 'da-mcp'], code: 0 },
    ])
    const result = await runUpgradeBinary(baseOpts({ fs, exec, fetch: makeFetch(release, bytes) }))
    expect(result.changed).toBe(true)
    expect(result.verified).toBe(false)
    expect(ops.writes).toHaveLength(1)
  })

  it('throws NOT_FOUND when no asset matches', async () => {
    const bytes = new Uint8Array(Buffer.from('x', 'utf8'))
    const release: ReleaseInfo = {
      ...makeReleaseJson('v1.0.2', 0, bytes),
      assets: [{ name: 'da-mcp-darwin-arm64', size: 0, browser_download_url: 'u', digest: null }],
    }
    const { fs } = makeFs()
    await expect(runUpgradeBinary(baseOpts({ fs, fetch: makeFetch(release, bytes) })))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('throws NETWORK_FAILED on 404', async () => {
    const release = makeReleaseJson('v1.0.2', 0, new Uint8Array(0))
    const { fs } = makeFs()
    await expect(runUpgradeBinary(baseOpts({
      fs,
      fetch: makeFetch(release, new Uint8Array(0), 404),
    }))).rejects.toMatchObject({ code: 'NETWORK_FAILED' })
  })

  it('throws NATIVE_FAILED on size mismatch (truncated download)', async () => {
    const declared = 1024
    const actual = new Uint8Array(10)
    const release = makeReleaseJson('v1.0.2', declared, actual)
    const { fs } = makeFs()
    await expect(runUpgradeBinary(baseOpts({ fs, fetch: makeFetch(release, actual) })))
      .rejects.toMatchObject({ code: 'NATIVE_FAILED' })
  })

  it('reports restart failure without aborting the rest', async () => {
    const bytes = new Uint8Array(Buffer.from('data', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, bytes)
    const { fs, ops } = makeFs()
    const exec = makeExec([
      { cmd: 'sc.exe', args: ['query', 'da-mcp'], code: 0 },
      { cmd: 'sc.exe', args: ['stop', 'da-mcp'], code: 2 },
    ])
    const result = await runUpgradeBinary(baseOpts({ fs, exec, fetch: makeFetch(release, bytes) }))
    expect(result.changed).toBe(true)
    expect(result.restart.attempted).toBe(true)
    expect(result.restart.ok).toBe(false)
    expect(ops.writes).toHaveLength(1)
    expect(ops.renames).toHaveLength(2)
  })

  it('skips restart when no service installed', async () => {
    const bytes = new Uint8Array(Buffer.from('data', 'utf8'))
    const release = makeReleaseJson('v1.0.2', bytes.byteLength, bytes)
    const { fs } = makeFs()
    const exec = makeExec([{ cmd: 'sc.exe', args: ['query', 'da-mcp'], code: 1 }])
    const result = await runUpgradeBinary(baseOpts({ fs, exec, fetch: makeFetch(release, bytes) }))
    expect(result.changed).toBe(true)
    expect(result.restart.attempted).toBe(false)
  })

  it('throws NETWORK_FAILED when fetch itself throws', async () => {
    const bytes = new Uint8Array(0)
    const { fs } = makeFs()
    const throwingFetch: typeof globalThis.fetch = () => {
      throw new DaMcpError('NETWORK_FAILED', 'simulated DNS failure')
    }
    await expect(runUpgradeBinary(baseOpts({ fs, fetch: throwingFetch })))
      .rejects.toMatchObject({ code: 'NETWORK_FAILED' })
  })
})