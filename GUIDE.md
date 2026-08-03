# da-mcp Installation Guide

Step-by-step installation instructions for all supported platforms (Linux X11, Linux Wayland, macOS, Windows), plus MCP client setup, verification, and troubleshooting.

This guide complements `README.md` — README is the high-level overview, this document is the hands-on walkthrough.

---

## Table of contents

1. [Quick start](#quick-start)
2. [System requirements](#system-requirements)
3. [Install on Linux (X11)](#install-on-linux-x11)
4. [Install on Linux (Wayland)](#install-on-linux-wayland)
5. [Install on macOS](#install-on-macos)
6. [Install on Windows](#install-on-windows)
7. [Configure your MCP client](#configure-your-mcp-client)
8. [Verify the installation](#verify-the-installation)
9. [Troubleshooting](#troubleshooting)
10. [Update and uninstall](#update-and-uninstall)

---

## Quick start

If you already have **Node.js 22+**, **npm 10+**, and the platform-specific binaries (`xdotool` / `ydotool` / `robotjs` deps / `tesseract`) installed, this is the whole install:

```bash
git clone <repo-url> da-mcp     # or: copy the project directory
cd da-mcp
npm install                    # compiles robotjs from source
npm run build                  # tsc → dist/
DA_MCP_TEST_MODE=mock npm test # 216 passed | 17 skipped expected
```

Then point your MCP client at `node /absolute/path/to/da-mcp/dist/server.js` and you're done.

For a guided setup, continue below.

---

## System requirements

| Requirement | Minimum |
|---|---|
| Node.js | 22.0+ (LTS recommended) |
| npm | 10.0+ (ships with Node 22) |
| RAM | 256 MB free |
| Disk | 200 MB (deps + `node_modules`) |

### Per-OS requirements

| OS | Tooling | Native build deps |
|---|---|---|
| Linux (X11) | `xdotool`, `x11-utils`, `tesseract-ocr` | `build-essential`, `libxtst-dev`, `libpng-dev`, `libx11-dev`, `libxkbcommon-dev`, `pkg-config`, `python3` |
| Linux (Wayland) | `ydotool` (daemon), `wtype`, `grim`, `tesseract-ocr` | Same as X11 |
| macOS | `tesseract` (Homebrew), Xcode CLT | `xcode-select --install` |
| Windows | `tesseract`, VS Build Tools | Visual Studio Build Tools (C++ workload), .NET 4.5+ (for PowerShell BitBlt) |

---

## Install on Linux (X11)

### Step 1 — System dependencies

**Ubuntu / Debian** (also used by the bundled script — tested on Ubuntu 25.10):

```bash
sudo apt update
sudo apt install -y \
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd \
  xdotool x11-utils \
  libxtst-dev libpng-dev libx11-dev libxkbcommon-dev \
  pkg-config build-essential python3 \
  git
```

Or simply:

```bash
sudo ./scripts/install-system-deps.sh
```

(The bundled script additionally installs `ydotool`, `wtype`, `scrot`, `maim`, `grim` for Wayland/CLI-fallback coverage.)

**Fedora / RHEL**:

```bash
sudo dnf install -y \
  tesseract tesseract-langpack-eng \
  xdotool xorg-x11-utils \
  gcc-c++ libXtst-devel libpng-devel libX11-devel libxkbcommon-devel \
  pkgconfig python3 git
```

**Arch / Manjaro**:

```bash
sudo pacman -S --noconfirm \
  tesseract tesseract-data-eng \
  xdotool xorg-x11-utils \
  base-devel libxtst libpng libx11 libxkbcommon \
  pkgconf python git
```

### Step 2 — Confirm X11 is available

```bash
echo "DISPLAY=$DISPLAY"
xdpyinfo | head -5      # should report display geometry
xdotool getmouselocation --shell   # prints x,y
```

If `DISPLAY` is empty, you're on Wayland — see [Install on Linux (Wayland)](#install-on-linux-wayland). If you're on a headless box, use Xvfb:

```bash
sudo apt install -y xvfb
Xvfb :0 -screen 0 1280x720x24 &
export DISPLAY=:0
```

### Step 3 — Clone and install

```bash
git clone <repo-url> da-mcp
cd da-mcp
npm install              # builds robotjs (~30–90s the first time)
```

### Step 4 — Build and verify

```bash
npm run build
npm run typecheck
DA_MCP_TEST_MODE=mock npm test
```

Expected: `216 passed | 17 skipped (env) | 0 failed`.

---

## Install on Linux (Wayland)

Wayland setups vary by compositor. The server will dispatch `ydotool` when `WAYLAND_DISPLAY` is set.

### Step 1 — Install daemon + tools

```bash
sudo apt install -y ydotool wtype grim tesseract-ocr
```

### Step 2 — Start `ydotoold`

`ydotool` needs a background daemon with a world-writable socket:

```bash
sudo systemctl enable --now ydotoold
sudo systemctl edit ydotoold   # add: ExecStart= ExecStart=/usr/bin/ydotoold --socket-perm 0666
sudo systemctl restart ydotoold
```

Verify the socket:

```bash
ls -l /tmp/.ydotool_socket   # should be 0666 or 0664 with your user in the group
```

If `ydotool` is unavailable on your distro, build from source:

```bash
git clone https://github.com/ReimuNotMoe/ydotool
cd ydotool
./bootstrap.sh && ./configure --enable-systemd-service=auto && sudo make install
```

### Step 3 — Verify compositor

```bash
echo "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"   # e.g. "wayland-0"
echo "XDG_SESSION_TYPE=$XDG_SESSION_TYPE" # "wayland"
```

If both are empty/unset, you don't have an active graphical session.

### Step 4 — npm install + build

Same as X11: `npm install`, `npm run build`, `npm test`.

**Sway** users — add to `~/.config/sway/config` for keyboard input:

```
exec ydotoold --socket-perm 0666
```

---

## Install on macOS

### Step 1 — Xcode Command Line Tools

```bash
xcode-select --install
```

### Step 2 — Homebrew + tesseract

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install node tesseract
```

`tesseract` ships with English language data by default.

### Step 3 — npm install + build

```bash
git clone <repo-url> da-mcp
cd da-mcp
npm install              # builds robotjs (CGEvent backend)
npm run build
DA_MCP_TEST_MODE=mock npm test
```

### Step 4 — Grant Screen Recording permission (one-time)

macOS requires explicit TCC approval before any process can capture the screen. The first call to `da_screenshot` will fail with `PERMISSION_DENIED` until you grant it:

1. Open **System Settings → Privacy & Security → Screen Recording**
2. Click **+**, then add your terminal (`Terminal.app`, `iTerm2`, `Ghostty`, etc.) **or** the binary path that launches the MCP server
3. Toggle the entry **ON**
4. **Restart your terminal AND the MCP client** (permissions apply to the running process, not to the binary)

To verify:

```bash
screencapture -x /tmp/test.png && file /tmp/test.png   # should print PNG
```

---

## Install on Windows

### Step 1 — Node.js 22+

Download the LTS installer from https://nodejs.org and run it. Verify:

```powershell
node --version    # v22.x.x
npm --version     # 10.x.x
```

### Step 2 — Visual Studio Build Tools

`robotjs` compiles a native SendInput DLL — you need MSVC.

```powershell
# Chocolatey
choco install -y visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"

# Or download directly:
# https://visualstudio.microsoft.com/visual-cpp-build-tools/
```

During installation, select the **"Desktop development with C++"** workload.

### Step 3 — Tesseract

```powershell
choco install -y tesseract
```

Or download the Windows installer from https://github.com/UB-Mannheim/tesseract/wiki. **Note the install path** — you'll need to set `DA_MCP_TESSERACT_BIN` if tesseract isn't on `$PATH`.

### Step 4 — npm install + build

```powershell
git clone <repo-url> da-mcp
cd da-mcp
npm install
npm run build
$env:DA_MCP_TEST_MODE = "mock"
npm test
```

### Step 5 — (Optional) PowerShell BitBlt fallback

The Windows CLI backend (`windowsCliBackend` in `src/screenshot/backends.ts`) uses PowerShell with `System.Drawing.Graphics.CopyFromScreen` as a fallback if `node-screenshots` fails. It requires **.NET Framework 4.5+** (ships with Windows 10+). No additional setup needed.

To verify PowerShell can capture:

```powershell
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 100,100
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
$bmp.Save("$env:TEMP\test.png")
```

---

## Configure your MCP client

The server speaks MCP over stdio. Every client launches it the same way: spawn `node` with the absolute path to `dist/server.js`. Replace `/absolute/path/to/da-mcp` with the real path.

### OpenCode

Edit `~/.config/opencode/config.json` (Linux/macOS) or `%APPDATA%\opencode\config.json` (Windows):

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/da-mcp/dist/server.js"],
      "env": {
        "DISPLAY": ":0",
        "DA_MCP_LOG": "info"
      }
    }
  }
}
```

### Claude Desktop

| OS | Config path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/da-mcp/dist/server.js"]
    }
  }
}
```

### Cursor

Edit `~/.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/da-mcp/dist/server.js"]
    }
  }
}
```

### Dev mode (no `npm run build`)

For active development, skip the build step and run from source:

```jsonc
{
  "mcpServers": {
    "da-mcp": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/da-mcp/src/server.ts"],
      "env": { "DA_MCP_LOG": "debug" }
    }
  }
}
```

**Restart the MCP client** after any config change — the server is launched on demand and won't pick up new config mid-session.

---

## Verify the installation

### 1. Type-check

```bash
npm run typecheck
```

Expected: no output, exit code 0.

### 2. Unit + e2e tests

```bash
DA_MCP_TEST_MODE=mock npm test
```

Expected: `216 passed | 17 skipped (env) | 0 failed`. The 17 skipped are e2e tests that require real X11/tesseract — they gracefully skip under mock mode.

### 3. Live launch

Start the server in a foreground terminal:

```bash
node /absolute/path/to/da-mcp/dist/server.js
```

It should print nothing to **stdout** (reserved for MCP). Set `DA_MCP_LOG=debug` to see startup logs on **stderr**:

```
[info] da-mcp starting platform=linux display=x11 tools=[xdotool,…]
[info] registered 12 tools
[debug] ready; transport=stdio
```

Then connect with your MCP client and call `tools/list`. You should see exactly 12 tools:

```
da_screenshot       da_ocr              da_list_displays
da_get_mouse_position  da_move_mouse  da_click     da_double_click
da_drag             da_scroll           da_type      da_key
da_launch
```

### 4. First real screenshot

From your MCP client:

```jsonc
{
  "tool": "da_screenshot",
  "arguments": { "display": 0 }
}
```

You should receive a base64-encoded PNG. If you get an error, jump to [Troubleshooting](#troubleshooting).

---

## Troubleshooting

### `Cannot find module 'robotjs'` / `node-gyp` errors during `npm install`

Native module didn't compile. Check that you have the build deps for your OS:

| OS | Required |
|---|---|
| Linux | `build-essential`, `libxtst-dev`, `libpng-dev`, `pkg-config`, `python3` |
| macOS | `xcode-select --install` |
| Windows | Visual Studio Build Tools (C++ workload), Python 3 |

Then:

```bash
npm rebuild robotjs
# or, nuclear option:
rm -rf node_modules package-lock.json && npm install
```

### `DISPLAY_NOT_FOUND` / "DISPLAY not set"

You're either headless or on Wayland.

```bash
# Check current session type
echo "DISPLAY=$DISPLAY"
echo "WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
```

- **X11 missing**: start Xvfb (`Xvfb :0 -screen 0 1280x720x24 &; export DISPLAY=:0`) or open a graphical session.
- **Wayland**: `export DISPLAY=:0` (XWayland) **or** unset `DISPLAY` and let the server auto-detect Wayland.

### `PERMISSION_DENIED` on `da_screenshot` (macOS)

1. **System Settings → Privacy & Security → Screen Recording**
2. Add and toggle ON: your terminal **and** the path to your MCP client's launcher binary
3. **Quit and reopen** both the terminal and the MCP client — TCC permissions are tied to the running process

To check what was granted:

```bash
# Show the Screen Recording database
sqlite3 ~/Library/Application\ Support/com.apple.TCC/TCC.db \
  'SELECT client, auth_value FROM access WHERE service="kTCCServiceScreenCapture";'
```

### `NATIVE_FAILED` / `NATIVE_MISSING` on input tools

The CLI tool isn't installed or isn't on `$PATH`.

| Tool | Check |
|---|---|
| `xdotool` | `which xdotool` (Linux X11) |
| `ydotool` | `which ydotool` and `systemctl status ydotoold` (Wayland) |
| `wtype` | `which wtype` (Wayland keyboard fallback) |
| `robotjs` | `node -e "require('robotjs')"` |

### `OCR_FAILED`

```bash
which tesseract       # should print a path
tesseract --version   # should report version 4+ or 5+
```

If `tesseract` is at a non-standard path:

```bash
export DA_MCP_TESSERACT_BIN=/full/path/to/tesseract
```

To force the WASM fallback (no system tesseract needed):

```bash
export DA_MCP_OCR_BACKEND=wasm
```

### `spawn ENOENT`

A child process couldn't be started. The error includes the missing binary name. Install it (see per-OS sections).

### Server starts but logs nothing

All logs go to **stderr**, not stdout (stdout is reserved for MCP framing). To see logs:

```bash
DA_MCP_LOG=debug node dist/server.js 2>server.log
tail -f server.log
```

### `NODE_MODULE_VERSION` mismatch after Node upgrade

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Tests pass locally but fail in CI

CI environments usually lack `$DISPLAY`, `tesseract`, `xdotool`. Always run tests with:

```bash
DA_MCP_TEST_MODE=mock npm test
```

`mock` mode short-circuits every native call; e2e tests skip themselves. This is the canonical CI invocation.

---

## Update and uninstall

### Update

```bash
cd /absolute/path/to/da-mcp
git pull                     # or: copy in the new files
npm install                  # picks up new deps
npm run build
DA_MCP_TEST_MODE=mock npm test
```

Then **restart your MCP client** to pick up the new server binary.

### Uninstall the project

```bash
rm -rf /absolute/path/to/da-mcp
```

Then remove the `da-mcp` entry from your MCP client's config file.

### (Optional) remove system deps

```bash
# Debian / Ubuntu
sudo apt remove -y tesseract-ocr tesseract-ocr-eng \
                    xdotool ydotool wtype grim scrot maim

# Fedora
sudo dnf remove tesseract xdotool ydotool

# macOS
brew uninstall tesseract

# Windows (Chocolatey)
choco uninstall tesseract
```

You typically **shouldn't** remove `build-essential`, `libxtst-dev`, `libpng-dev`, etc. — they're useful for other native Node modules.

---

## See also

- [README.md](README.md) — feature overview, architecture, conventions
- [description.md](description.md) — project scope and requirements
- [scripts/install-system-deps.sh](scripts/install-system-deps.sh) — automated Ubuntu/Debian deps installer
- MCP spec — https://modelcontextprotocol.io/