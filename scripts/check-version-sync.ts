#!/usr/bin/env tsx
/**
 * Verify package.json version === src/version.ts SERVER_VERSION.
 *
 * Catches the latent bug where release commits bump package.json but forget to
 * bump src/version.ts (cf. issue #27 — serverInfo.version reported 0.1.6 in
 * v1.0.7 and v1.0.8 even though package.json was at 0.1.7 / 0.1.8).
 *
 * Both values are surfaced to different audiences:
 *   - package.json `version`           → the build-time constant embedded into
 *                                        the SEA binary via esbuild `--define`
 *                                        (consumed by `da-mcp upgrade`).
 *   - src/version.ts `SERVER_VERSION`  → the value surfaced in the MCP
 *                                        `initialize` response as
 *                                        `serverInfo.version` (consumed by MCP
 *                                        clients at handshake).
 *
 * If they drift, MCP hosts log a stale version forever and tooling that
 * compares the running version against `npm view da-mcp version` reports a
 * false drift and may flag the install as tampered.
 *
 * Exit codes:
 *   0   — versions match
 *   1   — versions differ
 *   2   — could not parse one of the files
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

interface CheckResult {
  pkgVersion: string
  serverVersion: string
  matched: boolean
}

function readPkgVersion(): string {
  const raw = readFileSync(resolve(root, 'package.json'), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof (parsed as { version: unknown }).version !== 'string'
  ) {
    console.error('FATAL: package.json has no string `version` field')
    process.exit(2)
  }
  return (parsed as { version: string }).version
}

function readServerVersion(): string {
  const raw = readFileSync(resolve(root, 'src/version.ts'), 'utf8')
  // Match `SERVER_VERSION = '0.1.8' as const` (or without `as const`).
  const m = raw.match(/SERVER_VERSION\s*=\s*['"]([^'"]+)['"]/)
  if (!m || m[1] === undefined) {
    console.error('FATAL: could not parse SERVER_VERSION from src/version.ts')
    console.error('Expected a line like: export const SERVER_VERSION = \'0.1.8\' as const')
    process.exit(2)
  }
  return m[1]
}

function check(): CheckResult {
  const pkgVersion = readPkgVersion()
  const serverVersion = readServerVersion()
  return { pkgVersion, serverVersion, matched: pkgVersion === serverVersion }
}

const result = check()
if (result.matched) {
  console.log(`OK: package.json (${result.pkgVersion}) === src/version.ts SERVER_VERSION (${result.serverVersion})`)
  process.exit(0)
}

console.error('VERSION MISMATCH:')
console.error(`  package.json version:        ${result.pkgVersion}`)
console.error(`  src/version.ts SERVER_VERSION: ${result.serverVersion}`)
console.error('')
console.error('Both must match so MCP `serverInfo.version` is accurate at handshake.')
console.error('Update both in the same release commit. See issue #27.')
process.exit(1)
