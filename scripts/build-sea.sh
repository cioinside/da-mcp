#!/usr/bin/env bash
# Build a single-target Node SEA binary for da-mcp.
#
# Usage: scripts/build-sea.sh <target>
#   target: win32-x64 | linux-x64 | linux-arm64 | darwin-x64 | darwin-arm64
#
# Steps (Node 22 SEA + esbuild + postject):
#   1. Bundle src/server-dispatch.ts into one self-contained ESM file via
#      esbuild. `tsc` only compiles TS → JS but does NOT inline npm
#      imports — SEA needs every dependency baked into the blob, so a
#      bundling pass is mandatory.
#   2. Copy the runner's `node` binary as the SEA shell.
#   3. Write a per-target SEA config pointing to the bundled file.
#   4. Run `node --experimental-sea-config` to produce the SEA blob.
#   5. Run `npx postject` to inject the blob into the shell binary.
#      Do NOT pass `--sentinel-fuse NODE_SEA` — that string appears
#      multiple times in the Node binary itself and postject refuses
#      with "Multiple occurences of sentinel". The default fuse is fine.
#   6. Clean up intermediate files.
#
# Output: dist-sea/<target>/da-mcp-<target>[.exe]. Windows gets the `.exe`
# suffix so shell-out wrappers (PowerShell, Command Prompt) can spawn it;
# POSIX targets stay extensionless by convention.
#
# Prereqs (the caller — typically release.yml — must provide these):
#   - Node 22+ on PATH
#   - npm ci already run (postject + esbuild present in node_modules)
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: $0 <target>" >&2
  echo "Targets: win32-x64, linux-x64, linux-arm64, darwin-x64, darwin-arm64" >&2
  exit 64
fi

case "$TARGET" in
  win32-x64|linux-x64|linux-arm64|darwin-x64|darwin-arm64) ;;
  *) echo "Unknown target: $TARGET (expected win32-x64|linux-x64|linux-arm64|darwin-x64|darwin-arm64)" >&2; exit 64 ;;
esac

case "${TARGET%%-*}" in
  win32) EXT=".exe" ;;
  *)     EXT="" ;;
esac

ARTIFACT_DIR="dist-sea/${TARGET}"
BUNDLE="${ARTIFACT_DIR}/bundle.cjs"
ARTIFACT="${ARTIFACT_DIR}/da-mcp-${TARGET}${EXT}"
mkdir -p "$ARTIFACT_DIR"

# 1. Bundle — single self-contained CJS file. esbuild keeps `node:*`
# built-ins external and inlines everything from `node_modules`, which is
# what the SEA blob loader expects. CJS is required because Node 22's
# SEA embedder runs the embedded script via the CJS embedder path
# (node:internal/main/embedding:60); ESM bundles fail with "Cannot use
# import statement outside a module" even when the file has a `.mjs`
# extension.
#
# `--define:process.env.DA_MCP_VERSION=...` substitutes the literal at
# bundle time so `server-dispatch.ts:readEmbeddedVersion()` can know the
# version of the running binary without `package.json` on disk. This is
# what powers `da-mcp upgrade` in binary mode: it compares the embedded
# version to the latest GitHub release tag.
DA_MCP_VERSION="$(node -p "require('./package.json').version")"
export DA_MCP_VERSION

# Base64-encode the tesseract traineddata so the WASM backend in the SEA
# binary can run OCR offline on first use. The encoded string is passed
# into esbuild via the config file (`sea-esbuild.config.mjs`) — the CLI
# flag approach would blow past ARG_MAX (~2 MB on Linux) for a ~30 MB
# base64 payload. The corresponding consumer is
# `src/ocr/bundled-tessdata.ts:ensureBundledTessdata()`.
TESSDATA_FILE="assets/eng.traineddata"
TESSDATA_B64_FILE="dist-sea/_bundled-tessdata.b64"
DA_MCP_BUNDLED_TESSDATA_B64=""
mkdir -p "$(dirname "$TESSDATA_B64_FILE")"
if [ -f "$TESSDATA_FILE" ]; then
  RAW_BYTES="$(stat -c%s "$TESSDATA_FILE")"
  # base64 → file (not env var) — a 30 MB env var would blow ARG_MAX (~2 MB
  # on Linux) at every npx → node → esbuild exec hop. The file is read once
  # by `sea-esbuild.config.mjs` and removed below.
  base64 -w0 "$TESSDATA_FILE" > "$TESSDATA_B64_FILE"
  B64_BYTES="$(stat -c%s "$TESSDATA_B64_FILE")"
  echo "Bundling traineddata: ${RAW_BYTES} bytes (raw) / ${B64_BYTES} bytes (base64)"
else
  echo "WARNING: $TESSDATA_FILE not found; SEA OCR will require network on first use" >&2
  : > "$TESSDATA_B64_FILE"
fi

export SEA_BUNDLED_TESSDATA_FILE="$TESSDATA_B64_FILE"
export SEA_BUNDLE_OUT="$BUNDLE"
# Use the esbuild JS API wrapper at the repo root — esbuild 0.28's CLI does
# NOT auto-discover config files and the CLI --define flag would blow ARG_MAX.
node esbuild.config.mjs
rm -f "$TESSDATA_B64_FILE"

NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi

# 2. Copy the runner's node binary as the SEA shell.
cp "$NODE_BIN" "$ARTIFACT"
chmod +x "$ARTIFACT"

# 3. SEA config — main is the esbuild bundle, not the raw tsc output.
cat > sea-config.json <<EOF
{
  "main": "${BUNDLE}",
  "output": "${ARTIFACT_DIR}/sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
EOF

# 4 + 5. Generate the blob and inject it.
node --experimental-sea-config sea-config.json
npx --yes postject "$ARTIFACT" NODE_SEA_BLOB "${ARTIFACT_DIR}/sea-prep.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --overwrite

# 6. Cleanup.
rm -f sea-config.json "${ARTIFACT_DIR}/sea-prep.blob"

echo "Built ${ARTIFACT}"
