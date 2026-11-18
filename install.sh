#!/bin/bash
# ARCHIVEFLIX installer. Run with bash, not sh (this script uses bash
# features). Double-click "Install ARCHIVEFLIX", or run: bash install.sh
#
# Installs the app files to ~/.local/share/archiveflix, puts an
# ARCHIVEFLIX icon on the desktop and in the app menu. After that,
# opening ARCHIVEFLIX needs no terminal at all.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$HOME/.local/share/archiveflix"
APPS_DIR="$HOME/.local/share/applications"
# The desktop folder has a localized name on non-English installs, so ask
# the system where it is when possible, falling back to ~/Desktop.
DESKTOP_DIR="$HOME/Desktop"
if command -v xdg-user-dir >/dev/null 2>&1; then
  XDG_DESKTOP_DIR="$(xdg-user-dir DESKTOP 2>/dev/null || true)"
  if [ -n "$XDG_DESKTOP_DIR" ]; then
    DESKTOP_DIR="$XDG_DESKTOP_DIR"
  fi
fi
ICON_SRC="$SRC_DIR/icons/icon-512.svg"

fail() { echo "INSTALL FAILED: $*" >&2; exit 1; }

echo "Installing ARCHIVEFLIX..."

# The icon and the app files must be here before anything is reported
# as installed. Never claim success with a broken icon.
[ -f "$ICON_SRC" ] || fail "icon file is missing: $ICON_SRC"
[ -f "$SRC_DIR/icons/icon-192.svg" ] || fail "icon file is missing: $SRC_DIR/icons/icon-192.svg"
[ -f "$SRC_DIR/index.html" ] || fail "index.html is missing from $SRC_DIR"
[ -f "$SRC_DIR/app.js" ] || fail "app.js is missing from $SRC_DIR"
[ -f "$SRC_DIR/styles.css" ] || fail "styles.css is missing from $SRC_DIR"
[ -f "$SRC_DIR/archiveflix.sh" ] || fail "archiveflix.sh is missing from $SRC_DIR"
[ -f "$SRC_DIR/archiveflix.desktop" ] || fail "archiveflix.desktop is missing from $SRC_DIR"

mkdir -p "$APP_DIR" "$APPS_DIR" "$APP_DIR/icons"

cp "$SRC_DIR/index.html" "$SRC_DIR/app.js" "$SRC_DIR/styles.css" "$APP_DIR/"
[ -f "$SRC_DIR/manifest.json" ] && cp "$SRC_DIR/manifest.json" "$APP_DIR/"
[ -f "$SRC_DIR/sw.js" ] && cp "$SRC_DIR/sw.js" "$APP_DIR/"
cp "$SRC_DIR/icons/icon-192.svg" "$SRC_DIR/icons/icon-512.svg" "$APP_DIR/icons/"
# PNG icons ship in the release tarball only (see README.md). Copy them
# when present; the install works fine from SVG alone, so their absence
# is never a failure.
for png in icon-180.png icon-192.png icon-512.png; do
  if [ -f "$SRC_DIR/icons/$png" ]; then
    cp "$SRC_DIR/icons/$png" "$APP_DIR/icons/"
  fi
done
cp "$ICON_SRC" "$APP_DIR/icon.svg"
cp "$SRC_DIR/archiveflix.sh" "$APP_DIR/archiveflix.sh"
chmod +x "$APP_DIR/archiveflix.sh"
# The launch time update checker, copied when the source tree has it
# (older source trees do not, and install fine without it).
if [ -f "$SRC_DIR/archiveflix-update.sh" ]; then
  cp "$SRC_DIR/archiveflix-update.sh" "$APP_DIR/archiveflix-update.sh"
  chmod +x "$APP_DIR/archiveflix-update.sh"
fi
# Record the installed version for the launch time update check. The
# checker reads APP_VERSION from app.js first and falls back to this
# file, so a missing VERSION file never breaks an install.
INSTALLED_VERSION="$(sed -n 's/^var APP_VERSION = "\(.*\)";.*$/\1/p' "$SRC_DIR/app.js" | head -n 1)"
if [ -n "$INSTALLED_VERSION" ]; then
  printf '%s\n' "$INSTALLED_VERSION" > "$APP_DIR/VERSION"
fi

# Desktop entry, with the real home folder path baked in. No quotes
# anywhere in Exec or Icon: the desktop file parser does not strip
# quotes, so a quoted path breaks the launcher. The home path is escaped
# for the sed replacement, so a |, &, or backslash in it cannot corrupt
# the substitution.
HOME_ESCAPED="$(printf '%s' "$HOME" | sed -e 's/[|&\\]/\\&/g')"
sed "s|@HOME@|$HOME_ESCAPED|g" "$SRC_DIR/archiveflix.desktop" > "$APPS_DIR/archiveflix.desktop"
chmod +x "$APPS_DIR/archiveflix.desktop"
if [ -d "$DESKTOP_DIR" ]; then
  cp "$APPS_DIR/archiveflix.desktop" "$DESKTOP_DIR/archiveflix.desktop"
  chmod +x "$DESKTOP_DIR/archiveflix.desktop"
fi

# Verify before reporting success.
[ -f "$APP_DIR/icon.svg" ] || fail "icon did not install to $APP_DIR/icon.svg"
[ -x "$APP_DIR/archiveflix.sh" ] || fail "launcher is not executable: $APP_DIR/archiveflix.sh"
[ -f "$APPS_DIR/archiveflix.desktop" ] || fail "desktop file did not install"
grep -Fxq "Exec=$HOME/.local/share/archiveflix/archiveflix.sh" "$APPS_DIR/archiveflix.desktop" \
  || fail "desktop file Exec line is wrong"
grep -Fxq "Icon=$HOME/.local/share/archiveflix/icon.svg" "$APPS_DIR/archiveflix.desktop" \
  || fail "desktop file Icon line is wrong"

# Mark the desktop icon trusted so it launches on double-click.
TRUSTED=0
if command -v gio >/dev/null 2>&1 && [ -f "$DESKTOP_DIR/archiveflix.desktop" ]; then
  if gio set "$DESKTOP_DIR/archiveflix.desktop" metadata::trusted true 2>/dev/null; then
    TRUSTED=1
  fi
fi

echo ""
echo "ARCHIVEFLIX is installed."
echo "Click the ARCHIVEFLIX icon on your desktop (or in the app menu) to open it."
echo "To remove it later, run bash uninstall.sh from the release folder."
if [ "$TRUSTED" -eq 0 ] && [ -f "$DESKTOP_DIR/archiveflix.desktop" ]; then
  echo "If double-clicking the desktop icon does not launch it, right-click it and choose Allow Launching."
fi

if [ -t 0 ]; then
  read -rp "Press Enter to close." _ || true
fi
