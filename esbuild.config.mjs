/**
 * SEA bundler — invokes esbuild via its JS API.
 *
 * Used by `scripts/build-sea.sh` because esbuild 0.28's CLI does NOT
 * auto-discover config files (that feature landed later) and because the
 * bundled traineddata is ~30 MB base64-encoded — that would blow past
 * ARG_MAX (~2 MB on Linux) at every exec hop in the npx → node → esbuild
 * chain if passed as a `--define:K=V` CLI argument.
 *
 * The base64 payload is read from `SEA_BUNDLED_TESSDATA_FILE`, a file
 * written by `build-sea.sh`. A 30 MB file is fine because exec only has
 * to carry a few bytes of env to read the path. The file is cleaned up by
 * `build-sea.sh` after this script returns.
 *
 * In dev (non-SEA) builds `SEA_BUNDLED_TESSDATA_FILE` is unset, the
 * `define` value is the empty string, and the helper at
 * `src/ocr/bundled-tessdata.ts:getBundledTessdataB64` returns null — see
 * that file for the offline-OCR contract.
 */
import { readFileSync, existsSync } from 'node:fs'
import { build } from 'esbuild'

const VERSION = process.env['DA_MCP_VERSION'] ?? ''
const TESSDATA_FILE = process.env['SEA_BUNDLED_TESSDATA_FILE'] ?? ''
const BUNDLE_OUT = process.env['SEA_BUNDLE_OUT'] ?? 'dist-sea/bundle.cjs'

if (VERSION.length === 0) {
  console.error('DA_MCP_VERSION env var must be set by build-sea.sh')
  process.exit(2)
}

let BUNDLED_TESSDATA_B64 = ''
if (TESSDATA_FILE.length > 0 && existsSync(TESSDATA_FILE)) {
  BUNDLED_TESSDATA_B64 = readFileSync(TESSDATA_FILE, 'utf8').trim()
} else if (TESSDATA_FILE.length > 0) {
  console.error(`SEA_BUNDLED_TESSDATA_FILE points to a missing file: ${TESSDATA_FILE}`)
  process.exit(2)
}

await build({
  entryPoints: ['src/server-dispatch.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: BUNDLE_OUT,
  define: {
    'process.env.DA_MCP_VERSION': JSON.stringify(VERSION),
    'process.env.DA_MCP_BUNDLED_TESSDATA_B64': JSON.stringify(BUNDLED_TESSDATA_B64),
  },
  legalComments: 'none',
  logLevel: 'info',
})

if (BUNDLED_TESSDATA_B64.length > 0) {
  console.log(`Bundling traineddata: ${BUNDLED_TESSDATA_B64.length} bytes (base64)`)
} else {
  console.log('WARNING: SEA_BUNDLED_TESSDATA_FILE not set — SEA OCR will require network on first use')
}