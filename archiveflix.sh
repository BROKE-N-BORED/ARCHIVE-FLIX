#!/bin/bash
# ARCHIVEFLIX launcher. Opens the installed app in the browser: app mode
# when a Chromium browser is available, a plain window otherwise.
# Installed by install.sh to ~/.local/share/archiveflix/. No terminal
# window stays open behind it.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
URL="file://$APP_DIR/index.html"

for browser in google-chrome-stable google-chrome chromium chromium-browser brave-browser microsoft-edge-stable microsoft-edge; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --app="$URL" --no-first-run
  fi
done

exec xdg-open "$URL"
