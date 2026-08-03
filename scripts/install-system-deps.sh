#!/usr/bin/env bash
set -euo pipefail

# Install system dependencies for da-mcp.
# Tested on Ubuntu 25.10 / Debian 12+.

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Re-running with sudo..." >&2
  exec sudo --preserve-env=DISPLAY bash "$0" "$@"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  tesseract-ocr \
  tesseract-ocr-eng \
  tesseract-ocr-osd \
  xdotool \
  ydotool \
  wtype \
  scrot \
  maim \
  grim \
  libxtst-dev \
  libpng-dev \
  libx11-dev \
  libxkbcommon-dev \
  pkg-config \
  build-essential \
  python3 \
  git

echo
echo "Verify installed:"
echo "  tesseract: $(tesseract --version 2>&1 | head -1)"
echo "  xdotool:   $(xdotool --version 2>&1)"
echo "  scrot:     $(scrot --version 2>&1 || echo 'installed (no --version flag)')"