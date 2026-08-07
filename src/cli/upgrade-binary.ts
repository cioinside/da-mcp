/**
 * `da-mcp upgrade` — binary-mode pipeline.
 *
 * Replaces the running executable with the matching asset from the latest
 * GitHub release. Source installs (where the user invokes via `node
 * dist/server-dispatch.js upgrade`) are handled by `src/cli/upgrade.ts`;
 * `src/server-dispatch.ts` selects the right one with `isBinaryInstall()`.
 *
 * Pipeline:
 *   1. fetchLatestRelease({ repo })                        (mocked via inject)
 *   2. compareSemver(release.tag, currentVersion) → 0/-1 early-out
 *   3. pickAsset(platform, arch) from release.assets
 *   4. download asset → `${execPath}.new.${ts}`            (mocked via inject)
 *   5. if asset.digest is `sha256:...` → verify with web crypto
 *   6. rename execPath → `${execPath}.old.${ts}`           (Windows-allowed)
 *   7. rename staged    → execPath                         (atomic on POSIX)
 *   8. attemptServiceRestart({ ... })                       (supervisor)
 *      On Windows the .old copy is left in place so the operator can roll
 *      back manually; `da-mcp upgrade --prune-backups` cleans them up.
 *
 * All IO is injectable so tests run fully offline.
 */
import { createHash } from 'node:crypto'
import { stat, writeFile, rename } from 'node:fs/promises'
import { DaMcpError } from '../errors.js'
import { attemptServiceRestart, type RestartAttempt } from './install-service.js'
import type { ExecFn } from './exec.js'
import { fetchLatestRelease, compareSemver, type ReleaseInfo } from '../github-releases.js'

export interface UpgradeBinaryFs {
  readonly writeFile: (path: string, data: Uint8Array) => Promise<void>
  readonly rename: (from: string, to: string) => Promise<void>
  readonly stat: (path: string) => Promise<{ size: number }>
}

export interface UpgradeBinaryOptions {
  readonly repo: string
  readonly currentVersion: string
  readonly execPath: string
  readonly platform: NodeJS.Platform
  readonly arch: NodeJS.Architecture
  readonly force: boolean
  readonly exec: ExecFn
  readonly fs: UpgradeBinaryFs
  readonly env: NodeJS.ProcessEnv
  readonly log: (msg: string) => void
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
}

export interface UpgradeBinaryResult {
  readonly currentVersion: string
  readonly latestVersion: string
  readonly changed: boolean
  readonly releaseTag: string
  readonly releaseUrl: string
  readonly assetName: string
  readonly downloadBytes: number
  readonly verified: boolean
  readonly execPath: string
  readonly backupPath: string
  readonly restart: RestartAttempt
}

export function defaultFs(): UpgradeBinaryFs {
  return {
    writeFile: async (path, data) => { await writeFile(path, data) },
    rename: async (from, to) => { await rename(from, to) },
    stat: async (path) => {
      const s = await stat(path)
      return { size: s.size }
    },
  }
}

function assetSuffix(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '.exe' : ''
}

function archSuffix(arch: NodeJS.Architecture): 'x64' | 'arm64' | 'x86' | null {
  if (arch === 'x64') return 'x64'
  if (arch === 'arm64') return 'arm64'
  if (arch === 'ia32') return 'x86'
  return null
}

export function expectedAssetName(platform: NodeJS.Platform, arch: NodeJS.Architecture): string {
  const archS = archSuffix(arch)
  if (archS === null) {
    throw new DaMcpError('UNSUPPORTED_PLATFORM', `Cannot build asset name for arch '${arch}'.`)
  }
  return `da-mcp-${platform}-${archS}${assetSuffix(platform)}`
}

export function pickAsset(release: ReleaseInfo, assetName: string) {
  const a = release.assets.find((x) => x.name === assetName)
  if (a === undefined) {
    throw new DaMcpError(
      'NOT_FOUND',
      `Release ${release.tag_name} has no asset named ${assetName}. `
        + `Available: ${release.assets.map((x) => x.name).join(', ') || '(none)'}`,
    )
  }
  return a
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseDigest(digest: string | null): string | null {
  if (digest === null) return null
  if (!digest.startsWith('sha256:')) return null
  return digest.slice('sha256:'.length).toLowerCase()
}

async function downloadAsset(
  asset: { browser_download_url: string; size: number },
  fetchFn: typeof globalThis.fetch | undefined,
  log: (m: string) => void,
): Promise<Uint8Array> {
  if (fetchFn === undefined) {
    throw new DaMcpError('NETWORK_FAILED', 'global fetch is unavailable; pass opts.fetch explicitly')
  }
  log(`downloading ${asset.browser_download_url}...`)
  const res = await fetchFn(asset.browser_download_url, {
    headers: { 'User-Agent': 'da-mcp-self-updater' },
  })
  if (!res.ok) {
    throw new DaMcpError(
      'NETWORK_FAILED',
      `Asset download returned ${String(res.status)} ${res.statusText}`,
    )
  }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (asset.size > 0 && buf.byteLength !== asset.size) {
    throw new DaMcpError(
      'NATIVE_FAILED',
      `Downloaded ${buf.byteLength} bytes, expected ${asset.size} (truncated or partial response).`,
    )
  }
  return buf
}

export async function runUpgradeBinary(opts: UpgradeBinaryOptions): Promise<UpgradeBinaryResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch
  if (fetchFn === undefined) {
    throw new DaMcpError('NETWORK_FAILED', 'global fetch is unavailable; pass opts.fetch explicitly')
  }
  const fs = opts.fs
  const now = opts.now ?? Date.now
  const ts = now()
  const log = opts.log

  log(`current version: ${opts.currentVersion}`)
  log(`querying GitHub releases for ${opts.repo}...`)
  const release = await fetchLatestRelease({ repo: opts.repo, fetch: fetchFn })

  const latestVersion = release.tag_name
  const cmp = compareSemver(latestVersion, opts.currentVersion)
  if (cmp <= 0 && !opts.force) {
    log(`already at ${opts.currentVersion} (release is ${latestVersion}); nothing to do.`)
    return {
      currentVersion: opts.currentVersion,
      latestVersion,
      changed: false,
      releaseTag: latestVersion,
      releaseUrl: release.html_url,
      assetName: '',
      downloadBytes: 0,
      verified: false,
      execPath: opts.execPath,
      backupPath: '',
      restart: { attempted: false, ok: false, detail: 'no upgrade performed' },
    }
  }

  const assetName = expectedAssetName(opts.platform, opts.arch)
  const asset = pickAsset(release, assetName)
  log(`picked asset ${asset.name} (${asset.size} bytes)`)

  const bytes = await downloadAsset(asset, fetchFn, log)
  const expectedSha = parseDigest(asset.digest)
  let verified = false
  if (expectedSha !== null) {
    const actual = await sha256Hex(bytes)
    verified = actual === expectedSha
    if (!verified) {
      throw new DaMcpError(
        'NATIVE_FAILED',
        `sha256 mismatch: expected ${expectedSha}, got ${actual}. Aborting before any rename.`,
      )
    }
    log(`sha256 verified: ${actual}`)
  } else {
    log('warning: release asset has no sha256 digest; skipping verification.')
  }

  const stagedPath = `${opts.execPath}.new.${ts}`
  const backupPath = `${opts.execPath}.old.${ts}`
  log(`staging to ${stagedPath}`)
  await fs.writeFile(stagedPath, bytes)

  log(`renaming current binary → ${backupPath}`)
  await fs.rename(opts.execPath, backupPath)
  log(`activating staged binary → ${opts.execPath}`)
  await fs.rename(stagedPath, opts.execPath)

  log('checking for installed da-mcp system service...')
  const restart = await attemptServiceRestart({
    projectRoot: opts.execPath,
    exec: opts.exec,
    env: opts.env,
    ...((opts.platform === 'linux' || opts.platform === 'darwin' || opts.platform === 'win32')
      ? { platform: opts.platform }
      : {}),
  })

  return {
    currentVersion: opts.currentVersion,
    latestVersion,
    changed: true,
    releaseTag: latestVersion,
    releaseUrl: release.html_url,
    assetName: asset.name,
    downloadBytes: bytes.byteLength,
    verified,
    execPath: opts.execPath,
    backupPath,
    restart,
  }
}

export function makeUpgradeBinaryRunner(): (opts: UpgradeBinaryOptions) => Promise<UpgradeBinaryResult> {
  const fs = defaultFs()
  return (opts) => runUpgradeBinary({ ...opts, fs: opts.fs ?? fs })
}