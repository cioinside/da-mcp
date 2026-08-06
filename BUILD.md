# Distribution & build

This document describes how `da-mcp` is built and distributed. End users can
ignore this — see the [README](./README.md) for installation instructions.
This file is for maintainers.

## v1.0.0 contract (Windows-only)

A single self-contained binary for Windows x64. No Node.js install required
on the target machine.

```bash
curl -L https://github.com/cioinside/da-mcp/releases/latest/download/da-mcp-win32-x64.exe -o da-mcp.exe
da-mcp.exe
```

The Windows binary embeds the bundled JavaScript via Node 22's
[Single Executable Application](https://nodejs.org/api/single-executable-applications.html)
(SEA) feature. `screenshot-desktop` is the only remaining native NAPI
dependency and is statically embedded in the same `node.exe` shell that
SEA uses, so the binary is truly self-contained.

The only runtime prerequisite on Windows is `tesseract` (for OCR — see
[README § Cross-platform notes](./README.md#cross-platform-notes)).

## How a release happens

1. A maintainer pushes a `v*` tag (e.g. `v1.0.0`).
2. `.github/workflows/release.yml` runs:
   - `test` job runs the full `DA_MCP_TEST_MODE=mock` suite on Ubuntu.
   - Each target in the matrix whose name appears in
     `env.ENABLED_TARGETS` builds a SEA binary on the matching runner
     (Windows runner for `win32-x64`, macOS runner for `darwin-*`,
     Ubuntu runners for `linux-*`).
   - The `release` job attaches all produced binaries to the GitHub
     release page.
3. The release appears at
   <https://github.com/cioinside/da-mcp/releases/tag/v1.0.0>.

## Feature-flag architecture (#17)

`ENABLED_TARGETS` is a comma-separated string read from the
`workflow_dispatch` input named `enabled_targets`. It defaults to
`win32-x64` for tag pushes.

Each matrix job has the gate:

```yaml
if: contains(env.ENABLED_TARGETS, matrix.target)
```

GitHub Actions' `contains()` does substring matching on the string, so a
comma-separated value works without splitting. To enable additional
targets from the Actions UI (Run workflow → enabled_targets):

| Value | Builds |
|---|---|
| `win32-x64` (default) | Windows x64 only |
| `win32-x64,linux-x64` | Windows + Linux x64 |
| `win32-x64,linux-x64,darwin-arm64` | Windows + Linux x64 + macOS Apple Silicon |
| `win32-x64,linux-x64,linux-arm64,darwin-x64,darwin-arm64` | All 5 targets |

## Adding a new target

1. Pick a target name in `node-platform-arch` form
   (e.g. `linux-arm64`, `darwin-x64`). Add it to the `matrix.include`
   list in `.github/workflows/release.yml`, choosing a runner that
   either matches the target's native arch or has cross-compilation
   support (`ubuntu-22.04-arm` for `linux-arm64`).
2. Document the target in this file's "Feature-flag architecture"
   table.
3. If the target needs per-OS code that doesn't exist yet (e.g. macOS
   osascript keyboard/mouse — see issue #19), add the dispatcher +
   per-OS stub under `src/input/` first and verify `DA_MCP_TEST_MODE=mock
   npm test` is green.

## Local SEA build (smoke test)

```bash
npm ci
npm run build
npm run sea:build -- linux-x64
./dist-sea/linux-x64/da-mcp-linux-x64 --help
```

The `linux-x64` target can be built on any Linux/macOS runner. The
`win32-x64` target requires a Windows runner (or WSL with binfmt
configured for `pe` binary execution, which is not portable).

## Caveats

- **postject strips Authenticode signatures.** The Windows binary
  published by this workflow is unsigned. Windows SmartScreen will warn
  users on first run; document this in the release notes or add a
  re-sign step (e.g. `azure/login` + `azure/scripts/sign`) before
  publishing a public release.
- **macOS binaries are unsigned.** Gatekeeper will reject them unless
  users right-click → Open the first time, or the maintainer signs
  them with an Apple Developer ID and notarises.
- **Linux binaries have no extension.** POSIX convention. Shell-out
  wrappers (`xdg-open`, `setcap` for setuid binding, etc.) need the
  full filename.
