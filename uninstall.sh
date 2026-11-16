#!/bin/bash
# ARCHIVEFLIX uninstaller. Removes the installed app files, the app menu
# entry, and the desktop icon. Run with bash, not sh: bash uninstall.sh
# from the extracted release folder.
#
# Your watch history, My List, likes, and settings live in your browser,
# not in these files, so uninstalling does not touch them.
set -euo pipefail

APP_DIR="$HOME/.local/share/archiveflix"
APPS_FILE="$HOME/.local/share/applications/archiveflix.desktop"

# Same desktop folder lookup as install.sh: the folder has a localized
# name on non-English installs.
DESKTOP_DIR="$HOME/Desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  XDG_DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  if [ -n "$XDG_DESKTOP_DIR" ]; then
    DESKTOP_DIR="$XDG_DESKTOP_DIR"
  fi
fi
DESKTOP_FILE="$DESKTOP_DIR/archiveflix.desktop"

echo "This will remove ARCHIVEFLIX from this computer:"
echo "  $APP_DIR"
echo "  $APPS_FILE"
echo "  $DESKTOP_FILE"
echo ""
echo "Your watch history, My List, and settings live in your browser"
echo "and are not touched by this."
echo ""
read -rp "Remove ARCHIVEFLIX? [y/N] " ANSWER || true
case "$ANSWER" in
  y|Y|yes|YES|Yes)
    ;;
  *)
    echo "Cancelled. ARCHIVEFLIX is still installed."
    exit 0
    ;;
esac

# Stop the loopback server the launcher starts, if it is running.
if [ -f "$APP_DIR/.http-server.pid" ]; then
  SERVER_PID="$(cat "$APP_DIR/.http-server.pid" 2>/dev/null || true)"
  case "$SERVER_PID" in
    ''|*[!0-9]*)
      ;;
    *)
      kill "$SERVER_PID" 2>/dev/null || true
      ;;
  esac
fi

rm -rf "$APP_DIR"
rm -f "$APPS_FILE"
rm -f "$DESKTOP_FILE"
# Older installs always used ~/Desktop, even on systems where the
# desktop folder has another name now. Remove that copy too.
rm -f "$HOME/Desktop/archiveflix.desktop"

echo ""
echo "ARCHIVEFLIX is removed."
