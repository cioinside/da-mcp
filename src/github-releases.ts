/**
 * GitHub Releases API client for `da-mcp upgrade` (binary mode).
 *
 * Pure types + a `fetchLatestRelease` wrapper. The actual upgrade logic
 * lives in `src/cli/upgrade-binary.ts`; this module just normalises the
 * payload and exposes a tiny semver compare.
 *
 * All network IO goes through an injected `fetch` so tests can run
 * fully offline with a stub.
 */
import { DaMcpError } from './errors.js'

export interface ReleaseAsset {
  readonly name: string
  readonly size: number
  readonly browser_download_url: string
  /** GitHub returns `"sha256:<hex>"`; null if the field is missing or empty. */
  readonly digest: string | null
}

export interface ReleaseInfo {
  readonly tag_name: string
  readonly name: string
  readonly published_at: string
  readonly html_url: string
  readonly draft: boolean
  readonly prerelease: boolean
  readonly assets: readonly ReleaseAsset[]
}

interface GitHubReleasePayload {
  tag_name?: string
  name?: string
  published_at?: string
  html_url?: string
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{
    name?: string
    size?: number
    browser_download_url?: string
    digest?: string | null
  }>
}

export interface FetchLatestOptions {
  readonly repo: string
  readonly fetch?: typeof globalThis.fetch
  readonly signal?: AbortSignal
}

export async function fetchLatestRelease(opts: FetchLatestOptions): Promise<ReleaseInfo> {
  const fetchFn = opts.fetch ?? globalThis.fetch
  if (fetchFn === undefined) {
    throw new DaMcpError('NETWORK_FAILED', 'global fetch is unavailable; pass opts.fetch explicitly')
  }
  const url = `https://api.github.com/repos/${opts.repo}/releases/latest`
  const init: RequestInit = {
    headers: {
      'User-Agent': 'da-mcp-self-updater',
      Accept: 'application/vnd.github+json',
    },
  }
  if (opts.signal !== undefined) init.signal = opts.signal
  const res = await fetchFn(url, init)
  if (!res.ok) {
    throw new DaMcpError(
      'NETWORK_FAILED',
      `GitHub releases API returned ${String(res.status)} ${res.statusText}`,
    )
  }
  const data = (await res.json()) as GitHubReleasePayload
  return parseReleaseInfo(data)
}

export function parseReleaseInfo(d: GitHubReleasePayload): ReleaseInfo {
  if (typeof d.tag_name !== 'string' || d.tag_name.length === 0) {
    throw new DaMcpError('NETWORK_FAILED', 'release payload missing tag_name')
  }
  const assets = Array.isArray(d.assets) ? d.assets : []
  return {
    tag_name: d.tag_name,
    name: typeof d.name === 'string' ? d.name : d.tag_name,
    published_at: typeof d.published_at === 'string' ? d.published_at : '',
    html_url: typeof d.html_url === 'string' ? d.html_url : '',
    draft: d.draft === true,
    prerelease: d.prerelease === true,
    assets: assets.map((a) => ({
      name: typeof a.name === 'string' ? a.name : '',
      size: typeof a.size === 'number' ? a.size : 0,
      browser_download_url: typeof a.browser_download_url === 'string' ? a.browser_download_url : '',
      digest: typeof a.digest === 'string' && a.digest.length > 0 ? a.digest : null,
    })),
  }
}

export interface SemVerParts {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly raw: string
}

export function parseSemver(version: string): SemVerParts {
  const stripped = version.startsWith('v') || version.startsWith('V') ? version.slice(1) : version
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(stripped)
  if (m === null) {
    throw new DaMcpError('INTERNAL', `Invalid semver: ${version}`)
  }
  return {
    major: Number.parseInt(m[1] ?? '0', 10),
    minor: Number.parseInt(m[2] ?? '0', 10),
    patch: Number.parseInt(m[3] ?? '0', 10),
    raw: stripped,
  }
}

/** Returns -1 / 0 / 1 like `Array.prototype.sort`; prerelease/build tags are ignored. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const va = parseSemver(a)
  const vb = parseSemver(b)
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1
  return 0
}