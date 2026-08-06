# da-mcp — Crossplatform Desktop Automation MCP Server

A Model Context Protocol (MCP) server that lets AI agents (OpenCode, Claude Desktop, etc.) interact with a local desktop environment: screenshots, OCR with UI-element classification, mouse/keyboard control, and program launch — on Linux, macOS, and Windows.

> **For AI agents and automated installers:** Do NOT chain `apt install … && npm install && npm run build` by hand. Use the bundled installer scripts — they handle the platform-specific prerequisites (tesseract, xdotool, Node 22+) and surface native-binding / TCC failures as actionable errors instead of silent broken builds. See [Install (automated / AI agents)](#install-automated--ai-agents) below.

## Features

14 tools registered under the `da_*` namespace:

### Capture
- **`da_screenshot`** — Capture full screen or a specific display as PNG.
- **`da_ocr`** — Run OCR (Tesseract) on a screenshot and return structured text + UI element classification.
- **`da_list_displays`** — List connected displays with id, bounds, scale factor.

### Input
- **`da_get_mouse_position`** — Read current cursor position (X11/Linux uses `xdotool getmouselocation --shell`, Wayland uses `ydotool`, macOS/Windows uses `@nut-tree-fork/nut-js`).
- **`da_move_mouse`** — Move the cursor to (x, y).
- **`da_click`** — Click at (x, y) with optional button (left/right/middle/back/forward) and count.
- **`da_double_click`** — Convenience wrapper for double-click.
- **`da_drag`** — Drag from (x1, y1) to (x2, y2).
- **`da_scroll`** — Scroll wheel at (x, y) by (dx, dy).
- **`da_type`** — Type a string at the current focus.
- **`da_key`** — Press a single key or chord (e.g. `Ctrl+C`).

### Launch
- **`da_launch`** — Launch a program by name or path; returns a spawn handle with PID + POSIX signal exit codes (SIGINT=130, SIGTERM=143, SIGHUP=129, SIGKILL=137, SIGQUIT=131, SIGABRT=134).

### Window
- **`da_window_list`** — Enumerate all visible top-level windows (hwnd/pid/title/bounds/visibility). Cross-platform: `wmctrl` (Linux X11 + Wayland via XWayland), `osascript` + System Events (macOS), PowerShell + `user32!EnumWindows` (Windows).
- **`da_window_focus`** — Bring a window to the foreground by `hwnd`, `pid`, or title match (`exact` / `regex` / `substring`, case-insensitive). Title matching uses pure-JS resolver; multi-window Paint-style flows return a `NOT_FOUND` error when nothing matches.

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
  - **Input** — `src/input/{routing,mouse,keyboard,scroll,drag,types,index}.ts`. Shared routing helpers (`runCli`, `resolveRouting`, `requireTool`, `isMockMode`, `validateCoords`, `Routing`) in `routing.ts`; per-input-type operations in dedicated files. macOS/Windows path uses `@nut-tree-fork/nut-js` (libnut), statically imported.
  - **Launch** — `src/launch/{launch,types}.ts`. `open(1)` + `child_process.spawn` (shell:false); `SIGNAL_EXIT_CODES` map for POSIX signal mapping.
  - **Platform** — `src/platform/{detect,types}.ts`. `detectPlatform()` returns `{ os, display, tools, home }`; `assertPlatformSupported()` throws `PLATFORM_INIT_FAILED` on unsupported combos.
  - **Server** — `src/server.ts`. Registers 14 tools, wraps handler results into `CallToolResult` with `structuredContent` (Buffers stripped to `number[]` for JSON-safety), installs SIGINT/SIGTERM shutdown.
  - **Server instructions** — `src/server-instructions.ts`. Exports `SERVER_INSTRUCTIONS`, a string surfaced to the AI agent via the MCP `instructions` field (MCP spec, `ServerOptions.instructions`). Tells the agent it IS the orchestrator — call the 14 `da_*` tools directly through the MCP client, do NOT write an orchestrator script that imports/spawns the server. Edit this string to update the agent-facing announcement.
  - **Window** — `src/window/{types,list,list-linux,list-macos,list-windows,focus,resolve,index}.ts`. Per-OS list backends (wmctrl / osascript / PowerShell+EnumWindows) keep each file under the 250 LOC ceiling; pure-JS `matchOne` resolver in `resolve.ts` for title matching.

### Backend dispatch

| Capability | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Screenshot (Linux X11) | `node-screenshots` (XCap) | `screenshot-desktop` | — |
| Screenshot (Linux Wayland) | `node-screenshots` (XCap portal) | `screenshot-desktop` | — |
| Screenshot (macOS) | `node-screenshots` (CG) | `screencapture` | — |
| Screenshot (Windows) | `node-screenshots` (GDI) | PowerShell BitBlt (`windowsCliBackend`, ships in `backends.ts`) | — |
| Input (Linux X11) | `xdotool` CLI | — | — |
| Input (Linux Wayland) | `ydotool` CLI | `wtype` (keyboard only) | — |
| Input (macOS / Windows) | `@nut-tree-fork/nut-js` (libnut, ships prebuilt binaries) | — | — |
| OCR (any OS) | `tesseract` CLI | `tesseract.js@7` WASM | — |
| Window list + focus (Linux) | `wmctrl` CLI (X11 + XWayland on Wayland) | — | — |
| Window list + focus (macOS) | `osascript` + System Events | — | — |
| Window list + focus (Windows) | PowerShell + `user32!EnumWindows` / `SetForegroundWindow` | — | — |

Every `spawnSync`/`spawn` call uses `shell:false`. Permission-gated errors (e.g. macOS ScreenCaptureKit, Windows access denied) are detected via a tightened pattern (`screen…permission`, `screencapturekit`, `access is denied`) and re-thrown as `DaMcpError('PERMISSION_DENIED')`.

## Install (automated / AI agents)

If you are an AI agent setting this up on behalf of a user, or running scripted/CI installation, **use the bundled installer scripts**. Do not improvise a manual `npm install` chain — manual install bypasses the prompts that catch missing system tools and PATH issues, and turns platform-specific gotchas into silent broken builds.

| OS | Command |
|---|---|
| Linux | `sudo ./scripts/install-system-deps.sh && npm ci && npm run build && DA_MCP_TEST_MODE=mock npm test` |
| macOS | `./scripts/install-macos.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File scripts/install-windows.ps1` |

What each script does:

- **Verifies / installs system prerequisites** — tesseract, xdotool/ydotool (Linux), Node.js 22+ (Xcode CLT only needed if Homebrew is missing it — handled via `brew install` if so)
- **Runs `npm ci`** — locked, reproducible install. Avoid `npm install` (which resolves ranges and is slower)
- **Builds TypeScript** with `npm run build`
- **Runs `DA_MCP_TEST_MODE=mock npm test`** so the build is verified before you declare success
- **Prints the MCP client config snippet** to drop into Claude Desktop / OpenCode / etc.

If a script fails, **read its output** — the next step is printed at the end of each failure path. Do not retry by hand without first understanding what the script detected.

For manual / sandboxed installs where you cannot run the scripts, see [Install](#install) below.

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

The server speaks MCP over stdio. Configure your MCP client to launch `node /projects/da-mcp/dist/server-dispatch.js` (or `npx tsx src/server-dispatch.ts` for dev).

### HTTP (opt-in, token-protected)

Set `DA_MCP_TRANSPORT=http` to expose the server on `http://0.0.0.0:3000/<token>`. A 256-bit random token is generated on first start and persisted at:

| OS | Token path |
|---|---|
| Linux | `$XDG_CONFIG_HOME/da-mcp/token` or `~/.config/da-mcp/token` |
| macOS | `~/Library/Application Support/da-mcp/token` |
| Windows | `%APPDATA%\da-mcp\token` |

The token file is created with mode `0o600` (owner-only). Rotate it any time:

```bash
node /projects/da-mcp/dist/server-dispatch.js token regenerate
# → http://0.0.0.0:3000/<43-char-base64url-token>
# (substitute the host's LAN IP for 0.0.0.0 when configuring the remote client)
```

Override defaults with env vars:

- `DA_MCP_HTTP_HOST` — bind address (default `0.0.0.0` — LAN-reachable, token-gated); supports IPv4, IPv6 (`[::1]`), and hostname
- `DA_MCP_PORT` — port (default `3000`)
- `DA_MCP_TOKEN_PATH` — override token storage path

The URL is a **bearer-style token** — anyone with the token can call tools (mouse, keyboard, screenshot, launch). Default `0.0.0.0` bind means the daemon is reachable from any host that can route to this machine (LAN, VPN, public IP). The token is the sole auth — its 256-bit entropy is unguessable, but treat it as a password: protect the token file, and rotate it (`token regenerate`) if it may have leaked. To restrict the bind to the loopback interface only, set `DA_MCP_HTTP_HOST=127.0.0.1` — the server prints a one-line confirmation at startup.

#### Remote access from another host on the LAN

Because the default `DA_MCP_HTTP_HOST=0.0.0.0` already listens on all interfaces, no special launcher is needed:

```bash
DA_MCP_TRANSPORT=http npm start
# → server boots, binds 0.0.0.0:3000, prints URL with token to stderr
```

On the **remote** machine, configure your MCP client with `http://<lan-ip>:3000/<token>` — replace `0.0.0.0` with the host's actual LAN IP (`hostname -I`, `ipconfig getifaddr en0`, `ipconfig`).

Open the host firewall for inbound TCP on `DA_MCP_PORT` (default 3000) once per OS — this requires elevation and varies per platform:

| OS | Command |
|---|---|
| Linux (firewalld) | `sudo firewall-cmd --add-port=3000/tcp --permanent && sudo firewall-cmd --reload` |
| Linux (ufw) | `sudo ufw allow 3000/tcp` |
| macOS | System Settings → Network → Firewall → allow incoming for the `node` binary (or turn off the application firewall) |
| Windows (PowerShell, admin) | `New-NetFirewallRule -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -DisplayName "da-mcp"` |

### OpenCode / Claude Desktop example config

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["/projects/da-mcp/dist/server-dispatch.js"],
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
| Linux X11 | `node-screenshots` (X11 native) | `xdotool` | `wmctrl` for window list/focus (installed by `install-system-deps.sh`); x11-server-utils + XCap deps (handled by `install-system-deps.sh`) |
| Linux Wayland | `node-screenshots` (XCap portal) | `ydotool` (daemon) | `wmctrl` works via XWayland if XWayland apps are present |
| macOS | `node-screenshots` (CG) | `@nut-tree-fork/nut-js` (CGEvent) | First call needs Screen Recording permission (TCC) |
| Windows | `node-screenshots` (GDI) | `@nut-tree-fork/nut-js` (SendInput) | PowerShell BitBlt fallback if GDI fails |

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

- **20 test files**: 18 unit (`test/unit/`) + 2 e2e (`test/e2e/`)
- **322 tests passing / 18 skipped** in mock mode (e2e require real X11/tesseract)
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
- `DA_MCP_HTTP_HOST` — HTTP bind address (default `0.0.0.0` — LAN-reachable, token-gated); supports IPv4, IPv6, hostname
- `DA_MCP_TOKEN_PATH` — override the auth token storage path

## License

MIT
