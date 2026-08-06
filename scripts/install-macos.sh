#!/usr/bin/env bash
#
# Install da-mcp (desktop automation MCP server) on macOS.
#
# Steps performed:
#   1. Verifies macOS 12+ (Monterey or later)
#   2. Checks Homebrew is installed
#   3. Checks / installs tesseract via brew
#   4. Checks Xcode Command Line Tools (required for robotjs native build)
#   5. Checks Node.js 22+
#   6. Runs npm ci, npm run build, npm test (mock mode)
#   7. Prints the MCP client config snippet
#
# Tested on: macOS 14 (Sonoma), macOS 15 (Sequoia).
# Apple Silicon and Intel both supported (Homebrew path auto-detected).
#
# Usage:
#   ./scripts/install-macos.sh
#
# Skip steps:
#   SKIP_TESSERACT=1 ./scripts/install-macos.sh
#   SKIP_XCODE=1     ./scripts/install-macos.sh   # don't prompt for CLT install
#   SKIP_TEST=1      ./scripts/install-macos.sh
#
# Equivalent to scripts/install-system-deps.sh on Linux, but a full installer
# (deps + build + test + config) because brew has tighter scope than apt.
set -euo pipefail

# ─── Helpers ─────────────────────────────────────────────────────────────────

readonly C_RESET=$'\033[0m'
readonly C_BOLD=$'\033[1m'
readonly C_GREEN=$'\033[32m'
readonly C_CYAN=$'\033[36m'
readonly C_YELLOW=$'\033[33m'
readonly C_RED=$'\033[31m'
readonly C_MAGENTA=$'\033[35m'

step()    { printf '\n%s==>%s %s\n' "$C_MAGENTA" "$C_RESET" "$1"; }
ok()      { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
info()    { printf '  %s→%s %s\n' "$C_CYAN" "$C_RESET" "$1"; }
warn()    { printf '  %s⚠%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
fail()    { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"; exit 1; }

# ─── Step 1: macOS ──────────────────────────────────────────────────────────
step "1/6 Verifying macOS..."
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "This script is for macOS only. For Linux use scripts/install-system-deps.sh; for Windows use scripts/install-windows.ps1."
fi
OS_VERSION="$(sw_vers -productVersion 2>/dev/null || echo 'unknown')"
ok "macOS $OS_VERSION"

# ─── Step 2: Homebrew ───────────────────────────────────────────────────────
step "2/6 Checking Homebrew..."
if ! command -v brew >/dev/null 2>&1; then
  fail "Homebrew not installed. Install from https://brew.sh and re-run."
fi
BREW_VERSION="$(brew --version | head -1 | awk '{print $2}')"
ok "Homebrew $BREW_VERSION"

# ─── Step 3: tesseract ──────────────────────────────────────────────────────
step "3/6 Checking tesseract..."
if [[ "${SKIP_TESSERACT:-}" == "1" ]]; then
  warn "SKIP_TESSERACT=1 — skipping. da_ocr will use the WASM fallback (slower)."
elif command -v tesseract >/dev/null 2>&1; then
  TESS_VERSION="$(tesseract --version 2>&1 | head -1)"
  ok "$TESS_VERSION"
else
  info "Installing tesseract via brew..."
  brew install tesseract
  ok "tesseract installed"
fi

# ─── Step 4: Xcode Command Line Tools (robotjs native build) ───────────────
step "4/6 Checking Xcode Command Line Tools..."
if [[ "${SKIP_XCODE:-}" == "1" ]]; then
  warn "SKIP_XCODE=1 — skipping. robotjs will fail to build if CLT is missing."
elif xcode-select -p >/dev/null 2>&1 && [[ -x "$(xcode-select -p)/usr/bin/clang" ]]; then
  CLT_PATH="$(xcode-select -p)"
  ok "Xcode CLT at $CLT_PATH"
else
  warn "Xcode Command Line Tools not detected — robotjs native build will fail."
  if [[ -t 0 ]]; then
    read -r -p "  Install CLT now? (opens a dialog; ~5 min) [y/N] " choice
    if [[ "$choice" == "y" || "$choice" == "Y" ]]; then
      info "Triggering xcode-select --install..."
      xcode-select --install || true
      info "Re-run this script after CLT install completes."
      exit 0
    fi
  else
    fail "Non-interactive shell and CLT missing. Run 'xcode-select --install' manually and re-run."
  fi
fi

# ─── Step 5: Node.js 22+ ────────────────────────────────────────────────────
step "5/6 Checking Node.js 22+..."
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node --version | sed 's/^v//')"
  NODE_MAJOR="${NODE_VERSION%%.*}"
  if [[ "$NODE_MAJOR" -ge 22 ]]; then
    ok "Node.js v$NODE_VERSION"
    NODE_OK=1
  else
    warn "Node.js v$NODE_VERSION found (need 22+)"
  fi
fi
if [[ "$NODE_OK" -eq 0 ]]; then
  fail "Node.js 22+ required. Install via 'brew install node@22', nvm, or https://nodejs.org/"
fi

# ─── Step 6: Install, build, test ──────────────────────────────────────────
step "6/6 Installing dependencies, building, and testing..."
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

info "Running npm ci..."
npm ci --no-audit --no-fund
ok "npm ci complete"

info "Building TypeScript..."
npm run build
ok "Build complete: $PROJECT_ROOT/dist/server-dispatch.js"

if [[ "${SKIP_TEST:-}" == "1" ]]; then
  warn "SKIP_TEST=1 — skipping tests."
else
  info "Running tests (mock mode — skips native calls)..."
  if DA_MCP_TEST_MODE=mock npm test 2>&1 | tail -20; then
    ok "Tests passed"
  else
    fail "Tests failed. Run 'DA_MCP_TEST_MODE=mock npm test' for details."
  fi
fi

# ─── Summary ────────────────────────────────────────────────────────────────
SERVER_PATH="$PROJECT_ROOT/dist/server-dispatch.js"
CONFIG_JSON=$(cat <<EOF
{
  "mcpServers": {
    "da-mcp": {
      "command": "node",
      "args": ["$SERVER_PATH"]
    }
  }
}
EOF
)

printf '\n'
printf '%s╔════════════════════════════════════════════════════════════╗%s\n' "$C_GREEN" "$C_RESET"
printf '%s║              da-mcp installed successfully                 ║%s\n' "$C_GREEN" "$C_RESET"
printf '%s╚════════════════════════════════════════════════════════════╝%s\n' "$C_GREEN" "$C_RESET"
printf '\n'
info "Install path:  $PROJECT_ROOT"
info "Server entry:  $SERVER_PATH"
printf '\n'
info "Add this to your MCP client config (e.g. ~/Library/Application Support/Claude/claude_desktop_config.json):"
printf '\n'
printf '  %s\n' "$CONFIG_JSON"
printf '\n'
info "Test it:        node \"$SERVER_PATH\""
info "HTTP transport: DA_MCP_TRANSPORT=http node \"$SERVER_PATH\""
info "Token rotate:   node \"$SERVER_PATH\" token regenerate"
printf '\n'
