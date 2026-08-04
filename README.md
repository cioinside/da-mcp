# da-mcp — Crossplatform Desktop Automation MCP Server

A Model Context Protocol (MCP) server that lets AI agents (OpenCode, Claude Desktop, etc.) interact with a local desktop environment: screenshots, OCR with UI-element classification, mouse/keyboard control, and program launch — on Linux, macOS, and Windows.

## Features

12 tools registered under the `da_*` namespace:

### Capture
- **`da_screenshot`** — Capture full screen or a specific display as PNG.
- **`da_ocr`** — Run OCR (Tesseract) on a screenshot and return structured text + UI element classification.
- **`da_list_displays`** — List connected displays with id, bounds, scale factor.

### Input
- **`da_get_mouse_position`** — Read current cursor position (X11/Linux uses `xdotool getmouselocation --shell`, Wayland uses `ydotool`, macOS/Windows uses `robotjs`).
- **`da_move_mouse`** — Move the cursor to (x, y).
- **`da_click`** — Click at (x, y) with optional button (left/right/middle/back/forward) and count.
- **`da_double_click`** — Convenience wrapper for double-click.
- **`da_drag`** — Drag from (x1, y1) to (x2, y2).
- **`da_scroll`** — Scroll wheel at (x, y) by (dx, dy).
- **`da_type`** — Type a string at the current focus.
- **`da_key`** — Press a single key or chord (e.g. `Ctrl+C`).

### Launch
- **`da_launch`** — Launch a program by name or path; returns a spawn handle with PID + POSIX signal exit codes (SIGINT=130, SIGTERM=143, SIGHUP=129, SIGKILL=137, SIGQUIT=131, SIGABRT=134).

### UI element classification (OCR post-processing)

The `da_ocr` classifier tags each detected text region with one of:

| Category | Examples |
|---|---|
| `button` | "OK", "Cancel", "Apply" |
| `input` | Text fields, search boxes |
| `label` | Static descriptive text |
| `checkbox` | "☑ Enable", "☐ Dark mode" |
| `radio` | "◉ Local", "○ Network" |
| `menu` | Top-level menu headers ("File", "Edit") |
| `menu-item` | Dropdown entries ("New", "Open…") |
| `icon` | Toolbar / sidebar icons |

## Architecture

- **Language**: TypeScript 7.0 (strict, ESM, Node 22+); `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch` all on. Exact version pins (no `^`/`~`).
- **MCP SDK**: v2 (`@modelcontextprotocol/server@2.0.0`) over `StdioServerTransport` (production) and `InMemoryTransport` (tests).
- **Module layout** (250 LOC ceiling per file):
  - **Screenshot** — `src/screenshot/{png,backends,index,types}.ts`. PNG validation/encoding isolated in `png.ts`; backend dispatch (node-screenshots → screenshot-desktop → Windows CLI) in `backends.ts`.
  - **OCR** — `src/ocr/{cli,index,mock,parse,wasm,types,classify,classify-rules}.ts`. CLI backend (`runCli`), WASM fallback (`runWasm`), parser, mock; orchestrator in `index.ts` rethrows as `OCR_FAILED` when both backends fail.
  - **Input** — `src/input/{routing,mouse,keyboard,scroll,drag,types,index}.ts`. Shared routing helpers (`runCli`, `resolveRouting`, `requireTool`, `loadRobotjs`, `isMockMode`, `validateCoords`, `Routing`) in `routing.ts`; per-input-type operations in dedicated files.
  - **Launch** — `src/launch/{launch,types}.ts`. `open(1)` + `child_process.spawn` (shell:false); `SIGNAL_EXIT_CODES` map for POSIX signal mapping.
  - **Platform** — `src/platform/{detect,types}.ts`. `detectPlatform()` returns `{ os, display, tools, home }`; `assertPlatformSupported()` throws `PLATFORM_INIT_FAILED` on unsupported combos.
  - **Server** — `src/server.ts`. Registers 12 tools, wraps handler results into `CallToolResult` with `structuredContent` (Buffers stripped to `number[]` for JSON-safety), installs SIGINT/SIGTERM shutdown.

### Backend dispatch

| Capability | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Screenshot (Linux X11) | `node-screenshots` (XCap) | `screenshot-desktop` | — |
| Screenshot (Linux Wayland) | `node-screenshots` (XCap portal) | `screenshot-desktop` | — |
| Screenshot (macOS) | `node-screenshots` (CG) | `screencapture` | — |
| Screenshot (Windows) | `node-screenshots` (GDI) | PowerShell BitBlt (`windowsCliBackend`, ships in `backends.ts`) | — |
| Input (Linux X11) | `xdotool` CLI | — | — |
| Input (Linux Wayland) | `ydotool` CLI | `wtype` (keyboard only) | — |
| Input (macOS / Windows) | `robotjs` (native) | — | — |
| OCR (any OS) | `tesseract` CLI | `tesseract.js@7` WASM | — |

Every `spawnSync`/`spawn` call uses `shell:false`. Permission-gated errors (e.g. macOS ScreenCaptureKit, Windows access denied) are detected via a tightened pattern (`screen…permission`, `screencapturekit`, `access is denied`) and re-thrown as `DaMcpError('PERMISSION_DENIED')`.

## Install

```bash
# System dependencies (apt/dnf/brew; see scripts/install-system-deps.sh)
sudo ./scripts/install-system-deps.sh

# npm deps
npm install

# Build
npm run build

# Verify type-check (strict mode)
npm run typecheck

# Run all tests (mock mode — skips real native calls)
DA_MCP_TEST_MODE=mock npm test
```

## Run

### stdio (default)

The server speaks MCP over stdio. Configure your MCP client to launch `node /projects/da-mcp/dist/server.js` (or `npx tsx src/server.ts` for dev).

### HTTP (opt-in, token-protected)

Set `DA_MCP_TRANSPORT=http` to expose the server on `http://127.0.0.1:3000/<token>`. A 256-bit random token is generated on first start and persisted at:

| OS | Token path |
|---|---|
| Linux | `$XDG_CONFIG_HOME/da-mcp/token` or `~/.config/da-mcp/token` |
| macOS | `~/Library/Application Support/da-mcp/token` |
| Windows | `%APPDATA%\da-mcp\token` |

The token file is created with mode `0o600` (owner-only). Rotate it any time:

```bash
node /projects/da-mcp/dist/server.js token regenerate
# → http://127.0.0.1:3000/<43-char-base64url-token>
```

Override defaults with env vars:

- `DA_MCP_HTTP_HOST` — bind address (default `127.0.0.1`); supports IPv4, IPv6 (`[::1]`), and hostname
- `DA_MCP_PORT` — port (default `3000`)
- `DA_MCP_TOKEN_PATH` — override token storage path

The URL is **unauthenticated token** (bearer-style): anyone with the token can call tools. Bind only to `127.0.0.1` (default) — do not expose this to a network without adding an upstream auth proxy.

### OpenCode / Claude Desktop example config

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["/projects/da-mcp/dist/server.js"],
      "env": {
        "DISPLAY": ":0",
        "DA_MCP_LOG": "info"
      }
    }
  }
}
```

## Cross-platform notes

| OS | Screenshot | Input | Notes |
|---|---|---|---|
| Linux X11 | `node-screenshots` (X11 native) | `xdotool` | Requires `libxtst-dev libpng-dev` for robotjs build |
| Linux Wayland | `node-screenshots` (XCap portal) | `ydotool` (daemon) | XWayland fallback if available |
| macOS | `node-screenshots` (CG) | `robotjs` (CGEvent) | First call needs Screen Recording permission (TCC) |
| Windows | `node-screenshots` (GDI) | `robotjs` (SendInput) | VS Build Tools required; PowerShell BitBlt fallback if GDI fails |

## Development

```bash
# Strict type-check (no emit)
npx tsc --noEmit

# All tests in mock mode (CI default)
DA_MCP_TEST_MODE=mock npx vitest run

# Single test file
npx vitest run test/unit/screenshot.test.ts

# Watch mode
npx vitest
```

### Test inventory

- **18 test files**: 15 unit (`test/unit/`) + 3 e2e (`test/e2e/`)
- **216 tests passing / 17 skipped** in mock mode (e2e require real X11/tesseract)
- **Test runtime**: `process.env['DA_MCP_TEST_MODE'] === 'mock'` short-circuits native calls; `_mock.ts` modules inject deterministic native modules

### Conventions

- **250 LOC ceiling per file** (measured as non-blank, non-comment lines: `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' <file> | wc -l`)
- ESM imports use `.js` suffix even for `.ts` source
- All `spawn*` calls with `shell: false`
- All native errors wrapped in `DaMcpError` with typed `code` from `ErrorCode` union
- Public surface re-exported from `src/screenshot/index.ts` and `src/input/index.ts` — consumers import from there, not from per-operation files
- Forbidden: `as any`, `@ts-ignore`, `@ts-expect-error`, `console.log`, `shell: true`, auto-commits

## Environment variables

- `DISPLAY` — X11 display (Linux only)
- `WAYLAND_DISPLAY` — Wayland display socket
- `DA_MCP_LOG` — log level (`trace`|`debug`|`info`|`warn`|`error`), default `info`
- `DA_MCP_TESSERACT_BIN` — path to `tesseract` binary, default `tesseract`
- `DA_MCP_OCR_BACKEND` — `cli` (default) or `wasm`
- `DA_MCP_TEST_MODE` — `mock` skips real native calls in tests; e2e tests skip when set
- `DA_MCP_SCREENSHOT_BACKEND` — force a screenshot backend (`node-screenshots` | `screenshot-desktop` | `windows-cli`); default auto-detect
- `DA_MCP_TRANSPORT` — `stdio` (default) or `http`; `http` enables the opt-in HTTP transport
- `DA_MCP_PORT` — HTTP port when `DA_MCP_TRANSPORT=http` (default `3000`)
- `DA_MCP_HTTP_HOST` — HTTP bind address (default `127.0.0.1`); supports IPv4, IPv6, hostname
- `DA_MCP_TOKEN_PATH` — override the auth token storage path

## License

MIT
