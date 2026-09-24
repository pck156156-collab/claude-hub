#!/bin/bash
# Installs the game-dev toolchain for Claude Code on the web sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# System tools: Blender (3D -> sprites, headless), Inkscape (SVG), ImageMagick (image ops).
need=()
command -v blender >/dev/null || need+=(blender libegl1 libgl1 libglx-mesa0 libegl-mesa0)
command -v inkscape >/dev/null || need+=(inkscape)
command -v convert >/dev/null || need+=(imagemagick)
if [ ${#need[@]} -gt 0 ]; then
  apt-get update -q || true   # some third-party PPAs are blocked; the Ubuntu archive is enough
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${need[@]}"
fi

python3 -c "import PIL, numpy" 2>/dev/null || pip install -q --ignore-installed pillow numpy

# Web game stack: Phaser (2D), Three.js (3D), Vite, Playwright (screenshots).
npm install --no-audit --no-fund
