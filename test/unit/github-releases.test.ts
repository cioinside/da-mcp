import { describe, it, expect } from 'vitest'
import {
  parseSemver,
  compareSemver,
  parseReleaseInfo,
  fetchLatestRelease,
  type ReleaseInfo,
} from '../../src/github-releases.js'
import { DaMcpError } from '../../src/errors.js'

describe('parseSemver', () => {
  it('strips leading v', () => {
    expect(parseSemver('v1.2.3').raw).toBe('1.2.3')
    expect(parseSemver('V2.0.0').raw).toBe('2.0.0')
  })

  it('parses major.minor.patch', () => {
    const p = parseSemver('1.2.3')
    expect(p.major).toBe(1)
    expect(p.minor).toBe(2)
    expect(p.patch).toBe(3)
  })

  it('ignores prerelease and build metadata', () => {
    const p = parseSemver('4.5.6-rc.1+build.7')
    expect(p.major).toBe(4)
    expect(p.minor).toBe(5)
    expect(p.patch).toBe(6)
  })

  it('throws on garbage', () => {
    expect(() => parseSemver('not-a-version')).toThrow(DaMcpError)
    expect(() => parseSemver('1.2')).toThrow(DaMcpError)
    expect(() => parseSemver('')).toThrow(DaMcpError)
  })
})

describe('compareSemver', () => {
  it('orders major.minor.patch', () => {
    expect(compareSemver('1.0.0', '2.0.0')).toBe(-1)
    expect(compareSemver('2.0.0', '1.0.0')).toBe(1)
    expect(compareSemver('1.2.0', '1.1.0')).toBe(1)
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1)
  })

  it('returns 0 for equal', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0)
  })
})

describe('parseReleaseInfo', () => {
  it('extracts tag, assets, html_url', () => {
    const r = parseReleaseInfo({
      tag_name: 'v1.0.0',
      name: 'Release 1.0.0',
      published_at: '2026-08-07T00:00:00Z',
      html_url: 'https://github.com/x/y/releases/tag/v1.0.0',
      assets: [
        {
          name: 'da-mcp-win32-x64.exe',
          size: 89135616,
          browser_download_url: 'https://example.com/asset.exe',
          digest: 'sha256:abc123',
        },
      ],
    })
    expect(r.tag_name).toBe('v1.0.0')
    expect(r.assets).toHaveLength(1)
    const a = r.assets[0]
    expect(a).toBeDefined()
    expect(a?.name).toBe('da-mcp-win32-x64.exe')
    expect(a?.digest).toBe('sha256:abc123')
  })

  it('tolerates missing fields', () => {
    const r = parseReleaseInfo({ tag_name: 'v0.0.1' })
    expect(r.tag_name).toBe('v0.0.1')
    expect(r.assets).toEqual([])
    expect(r.published_at).toBe('')
    expect(r.draft).toBe(false)
  })

  it('coerces empty/null digest to null', () => {
    const r = parseReleaseInfo({
      tag_name: 'v0.0.1',
      assets: [{ name: 'x', size: 0, browser_download_url: 'y', digest: '' }],
    })
    expect(r.assets[0]?.digest).toBe(null)
  })

  it('throws when tag_name is missing', () => {
    expect(() => parseReleaseInfo({ tag_name: '' })).toThrow(DaMcpError)
    expect(() => parseReleaseInfo({})).toThrow(DaMcpError)
  })
})

describe('fetchLatestRelease', () => {
  function makeFetch(payload: unknown, status = 200): typeof globalThis.fetch {
    return ((_url: unknown, _init?: unknown) =>
      Promise.resolve(new Response(JSON.stringify(payload), { status, statusText: status === 200 ? 'OK' : 'FAIL' }))) as typeof globalThis.fetch
  }

  it('hits GitHub API and parses JSON', async () => {
    const payload = { tag_name: 'v2.0.0', assets: [] }
    const release: ReleaseInfo = await fetchLatestRelease({ repo: 'x/y', fetch: makeFetch(payload) })
    expect(release.tag_name).toBe('v2.0.0')
  })

  it('throws on non-2xx', async () => {
    const fetchErr = makeFetch({}, 404)
    await expect(fetchLatestRelease({ repo: 'x/y', fetch: fetchErr })).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    })
  })

  it('throws on missing tag_name in payload', async () => {
    const fetchBad = makeFetch({})
    await expect(fetchLatestRelease({ repo: 'x/y', fetch: fetchBad })).rejects.toMatchObject({
      code: 'NETWORK_FAILED',
    })
  })
})