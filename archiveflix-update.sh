#!/bin/bash
# ARCHIVEFLIX update checker. archiveflix.sh runs this on launch,
# before the app opens. It silently checks the GitHub Releases page
# for a newer release. Up to date, offline, or check failed: it exits
# quietly and the app launches normally. A newer release: it asks
# first, and only on a yes does it download the release file. The
# download is installed only after its SHA-256 matches the checksum
# published with the release: a SHA256SUMS sidecar asset when the
# release carries one, otherwise the SHA-256 printed in the release
# notes. With no checksum anywhere, or a checksum that does not
# match, it refuses to install and says why. After an install it
# asks before restarting.
#
# Exit codes: 0 = nothing installed, launch normally. 10 = update
# installed and the user said restart now (the launcher re-execs
# itself). 11 = update installed and the user said not now (the new
# files are in place; the running copy finishes from its cache and
# the update takes full effect on the next launch).
#
# Testing: set ARCHIVEFLIX_UPDATE_API_BASE to a base URL (for
# example http://127.0.0.1:PORT) to check a fixture server instead of
# api.github.com. The fixture must answer
# GET /repos/BROKE-N-BORED/ARCHIVE-FLIX/releases/latest with release
# JSON, and serve the asset URLs named in that JSON.
# ARCHIVEFLIX_SKIP_UPDATE_CHECK=1 skips the check entirely.
# ARCHIVEFLIX_UPDATE_DEBUG=1 logs progress to stderr.
set -euo pipefail

REPO="BROKE-N-BORED/ARCHIVE-FLIX"
API_BASE="${ARCHIVEFLIX_UPDATE_API_BASE:-https://api.github.com}"
TAB="$(printf '\t')"
APP_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
TMP_DIR=""

debug() {
  if [ -n "${ARCHIVEFLIX_UPDATE_DEBUG:-}" ]; then
    echo "ARCHIVEFLIX update: $*" >&2
  fi
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

# Show a message the user can actually see, same chain as the
# launcher: stderr first, then the best graphical option available.
show_message() {
  local msg="$1"
  echo "ARCHIVEFLIX: $msg" >&2
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --title="ARCHIVEFLIX" --text="$msg" 2>/dev/null || true
    return 0
  fi
  if command -v kdialog >/dev/null 2>&1; then
    kdialog --sorry "$msg" --title "ARCHIVEFLIX" 2>/dev/null || true
    return 0
  fi
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "ARCHIVEFLIX" "$msg" 2>/dev/null || true
  fi
}

# Ask a yes or no question. Returns 0 only on an explicit yes. No
# graphical asker, a failed dialog, or a no all return 1: the caller
# then launches normally and installs nothing, never blocking launch
# on a missing dialog tool.
ask_user() {
  local msg="$1"
  if command -v zenity >/dev/null 2>&1; then
    if zenity --question --title="ARCHIVEFLIX" --text="$msg" 2>/dev/null; then
      return 0
    fi
    return 1
  fi
  if command -v kdialog >/dev/null 2>&1; then
    if kdialog --yesno "$msg" --title "ARCHIVEFLIX" 2>/dev/null; then
      return 0
    fi
    return 1
  fi
  return 1
}

# Print the installed version, or nothing when it cannot be read.
# APP_VERSION in the installed app.js is the source of truth (it is
# the code actually installed); the VERSION file install.sh writes
# is the fallback. An unknown version means no check at all: without
# a version to compare against, every launch would offer the same
# release again.
installed_version() {
  local ver=""
  if [ -f "$APP_DIR/app.js" ]; then
    ver="$(sed -n 's/^var APP_VERSION = "\(.*\)";.*$/\1/p' "$APP_DIR/app.js" 2>/dev/null | head -n 1 || true)"
  fi
  if [ -z "$ver" ] && [ -f "$APP_DIR/VERSION" ]; then
    ver="$(head -n 1 "$APP_DIR/VERSION" 2>/dev/null | tr -d '[:space:]' || true)"
  fi
  printf '%s' "$ver"
}

# version_newer A B: return 0 when version A is newer than B.
# Leading "v" and any "-suffix" are ignored; components compare
# numerically, so 1.10.0 beats 1.9.9 and 1.6.10 beats 1.6.9.
version_newer() {
  local a="${1#v}" b="${2#v}"
  a="${a%%-*}" b="${b%%-*}"
  local -a ap bp
  IFS='.' read -ra ap <<< "$a"
  IFS='.' read -ra bp <<< "$b"
  local i av bv
  for i in 0 1 2 3 4 5; do
    av="${ap[$i]:-0}"; bv="${bp[$i]:-0}"
    av="${av//[^0-9]/}"; bv="${bv//[^0-9]/}"
    av="${av:-0}"; bv="${bv:-0}"
    if [ "$((10#$av))" -gt "$((10#$bv))" ]; then return 0; fi
    if [ "$((10#$av))" -lt "$((10#$bv))" ]; then return 1; fi
  done
  return 1
}

have_downloader() {
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1
}

# http_get URL FILE [MAX_TIME]: fetch URL into FILE. Short timeouts
# so a slow or missing network never delays launch noticeably.
http_get() {
  local url="$1" out="$2" max_time="${3:-10}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --max-time "$max_time" --connect-timeout 3 \
      -H "Accept: application/vnd.github+json" -o "$out" "$url" 2>/dev/null
  else
    wget -q -T "$max_time" --header="Accept: application/vnd.github+json" \
      -O "$out" "$url" 2>/dev/null
  fi
}

# parse_release JSON OUTDIR: pull the tag, the release notes body,
# and the asset list (name and download URL per line) out of the
# release JSON into tag.txt, body.txt and assets.txt under OUTDIR.
parse_release() {
  python3 - "$1" "$2" <<'PYEOF' || return 1
import json, os, sys
json_path, outdir = sys.argv[1], sys.argv[2]
with open(json_path, "r", encoding="utf-8") as handle:
    data = json.load(handle)
with open(os.path.join(outdir, "tag.txt"), "w", encoding="utf-8") as handle:
    handle.write(str(data.get("tag_name") or ""))
with open(os.path.join(outdir, "body.txt"), "w", encoding="utf-8") as handle:
    handle.write(str(data.get("body") or ""))
with open(os.path.join(outdir, "assets.txt"), "w", encoding="utf-8") as handle:
    for asset in data.get("assets") or []:
        name = asset.get("name") or ""
        url = asset.get("browser_download_url") or ""
        if name and url:
            handle.write(name + "\t" + url + "\n")
PYEOF
}

# pick_asset FILE PATTERN: print the "name<TAB>url" line of the first
# asset whose name matches the shell pattern (case-insensitive), or
# nothing.
pick_asset() {
  local file="$1" pattern="$2" name url
  while IFS="$TAB" read -r name url; do
    case "${name,,}" in
      $pattern) printf '%s\t%s' "$name" "$url"; return 0 ;;
    esac
  done < "$file" || true
  return 1
}

# hash_from_sidecar FILE TARBALL_NAME: print the SHA-256 for the
# tarball from a SHA256SUMS style file ("hash  filename" lines).
hash_from_sidecar() {
  local file="$1" name="$2" hash entry
  while read -r hash entry; do
    entry="${entry#\*}"
    if [ "$entry" = "$name" ] && printf '%s' "$hash" | grep -qE '^[0-9a-fA-F]{64}$'; then
      printf '%s' "$hash"
      return 0
    fi
  done < "$file" || true
  return 1
}

# hash_from_body BODY_FILE TARBALL_NAME: print the SHA-256 from the
# release notes, or nothing. Tries, in order: a line naming the
# tarball file, a line mentioning sha256, and a lone hash in the
# body. More than one hash with no filename or sha256 label is
# ambiguous, so it counts as no checksum.
hash_from_body() {
  local body="$1" name="$2" hash count
  hash="$(grep -F "$name" "$body" 2>/dev/null | grep -oE '[0-9a-fA-F]{64}' | head -n 1 || true)"
  if [ -n "$hash" ]; then printf '%s' "$hash"; return 0; fi
  hash="$(grep -iE 'sha-?256' "$body" 2>/dev/null | grep -oE '[0-9a-fA-F]{64}' | head -n 1 || true)"
  if [ -n "$hash" ]; then printf '%s' "$hash"; return 0; fi
  count="$(grep -oE '[0-9a-fA-F]{64}' "$body" 2>/dev/null | wc -l || true)"
  if [ "${count// /}" = "1" ]; then
    grep -oE '[0-9a-fA-F]{64}' "$body" 2>/dev/null | head -n 1
    return 0
  fi
  return 1
}

valid_app_tree() {
  local dir="$1"
  [ -f "$dir/index.html" ] && [ -f "$dir/app.js" ] && [ -f "$dir/styles.css" ] && [ -f "$dir/archiveflix.sh" ]
}

# find_release_root DIR: print the directory holding the app files:
# DIR itself, or one of its subdirectories (some tarballs wrap the
# app in a top level folder). Prints nothing when no directory holds
# a valid app tree.
find_release_root() {
  local dir="$1" sub
  if valid_app_tree "$dir"; then printf '%s' "$dir"; return 0; fi
  for sub in "$dir"/*/; do
    [ -d "$sub" ] || continue
    if valid_app_tree "${sub%/}"; then printf '%s' "${sub%/}"; return 0; fi
  done || true
  return 1
}

# install_files ROOT: copy the app files from ROOT over APP_DIR.
# Each file is staged next to its destination and moved into place,
# so a running launcher or checker keeps reading the old file it
# already has open. The loopback server pid file is untouched, and
# user data lives in the browser, not here, so replacing files is
# safe. Returns 0 on success.
install_files() {
  local root="$1" rel src dest stage
  mkdir -p "$APP_DIR/icons" || return 1
  for rel in index.html app.js styles.css manifest.json sw.js archiveflix.sh archiveflix-update.sh icons/icon-192.svg icons/icon-512.svg icons/icon-180.png icons/icon-192.png icons/icon-512.png; do
    src="$root/$rel"
    [ -f "$src" ] || continue
    dest="$APP_DIR/$rel"
    stage="$APP_DIR/.update-new-${rel//\//_}"
    cp "$src" "$stage" || return 1
    mv "$stage" "$dest" || return 1
  done
  chmod +x "$APP_DIR/archiveflix.sh" 2>/dev/null || true
  if [ -f "$APP_DIR/archiveflix-update.sh" ]; then
    chmod +x "$APP_DIR/archiveflix-update.sh" 2>/dev/null || true
  fi
  # Refresh the menu icon from the new 512 icon when the release
  # carries one, the same way install.sh does.
  if [ -f "$APP_DIR/icons/icon-512.svg" ]; then
    cp "$APP_DIR/icons/icon-512.svg" "$APP_DIR/.update-new-icon.svg" \
      && mv "$APP_DIR/.update-new-icon.svg" "$APP_DIR/icon.svg"
  fi
  # Record the new installed version.
  local new_ver
  new_ver="$(installed_version)"
  if [ -n "$new_ver" ]; then
    printf '%s\n' "$new_ver" > "$APP_DIR/.update-new-VERSION"
    mv "$APP_DIR/.update-new-VERSION" "$APP_DIR/VERSION"
  fi
  return 0
}

main() {
  if [ -n "${ARCHIVEFLIX_SKIP_UPDATE_CHECK:-}" ]; then
    debug "check skipped by ARCHIVEFLIX_SKIP_UPDATE_CHECK"
    return 0
  fi

  # Missing tools: skip silently, the app launches normally.
  if ! command -v python3 >/dev/null 2>&1; then debug "no python3, skipping"; return 0; fi
  if ! command -v sha256sum >/dev/null 2>&1; then debug "no sha256sum, skipping"; return 0; fi
  if ! command -v tar >/dev/null 2>&1; then debug "no tar, skipping"; return 0; fi
  if ! have_downloader; then debug "no curl or wget, skipping"; return 0; fi

  local installed
  installed="$(installed_version)"
  if [ -z "$installed" ]; then debug "installed version unknown, skipping"; return 0; fi
  debug "installed version: $installed"

  TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/archiveflix-update.XXXXXX")"
  trap cleanup EXIT

  local release_json="$TMP_DIR/release.json"
  if ! http_get "$API_BASE/repos/$REPO/releases/latest" "$release_json" 5; then
    debug "release check failed (offline or unreachable), launching normally"
    return 0
  fi
  if ! parse_release "$release_json" "$TMP_DIR"; then
    debug "could not parse release info, launching normally"
    return 0
  fi

  local latest
  latest="$(cat "$TMP_DIR/tag.txt")"
  if [ -z "$latest" ]; then debug "no release tag, launching normally"; return 0; fi
  if ! version_newer "$latest" "$installed"; then
    debug "up to date ($installed, latest $latest)"
    return 0
  fi
  debug "newer release available: $latest"

  # Find the release file asset. No usable asset: stay silent, there
  # is nothing the user could install.
  local tarball_line tarball_name tarball_url
  tarball_line="$(pick_asset "$TMP_DIR/assets.txt" '*archiveflix*.tar.gz' || true)"
  if [ -z "$tarball_line" ]; then
    tarball_line="$(pick_asset "$TMP_DIR/assets.txt" '*.tar.gz' || true)"
  fi
  if [ -z "$tarball_line" ]; then
    debug "release $latest has no .tar.gz asset, launching normally"
    return 0
  fi
  tarball_name="${tarball_line%%$TAB*}"
  tarball_url="${tarball_line#*$TAB}"

  local display_latest="${latest#v}"
  if ! ask_user "ARCHIVEFLIX $display_latest is available (you have $installed). Download and install it now?"; then
    debug "user declined the update"
    return 0
  fi

  # Resolve the expected checksum BEFORE downloading the release
  # file: a SHA256SUMS sidecar asset first, else the SHA-256 in the
  # release notes. Neither: refuse and say why.
  local expected=""
  local sidecar_line sidecar_url sidecar_file
  sidecar_line="$(pick_asset "$TMP_DIR/assets.txt" 'sha256sums' || true)"
  if [ -z "$sidecar_line" ]; then
    sidecar_line="$(pick_asset "$TMP_DIR/assets.txt" '*.sha256' || true)"
  fi
  if [ -n "$sidecar_line" ]; then
    sidecar_url="${sidecar_line#*$TAB}"
    sidecar_file="$TMP_DIR/SHA256SUMS"
    if http_get "$sidecar_url" "$sidecar_file" 10; then
      expected="$(hash_from_sidecar "$sidecar_file" "$tarball_name" || true)"
      if [ -n "$expected" ]; then debug "checksum from SHA256SUMS sidecar"; fi
    else
      debug "could not download the SHA256SUMS sidecar"
    fi
  fi
  if [ -z "$expected" ]; then
    expected="$(hash_from_body "$TMP_DIR/body.txt" "$tarball_name" || true)"
    if [ -n "$expected" ]; then debug "checksum from release notes"; fi
  fi
  if [ -z "$expected" ]; then
    show_message "ARCHIVEFLIX $display_latest is available, but the release publishes no SHA-256 checksum, so the download cannot be verified. The update was not installed. You can update by downloading the new release and reinstalling."
    return 0
  fi

  local tarball_file="$TMP_DIR/release.tar.gz"
  if ! http_get "$tarball_url" "$tarball_file" 300; then
    show_message "ARCHIVEFLIX $display_latest could not be downloaded. Check your connection and try again later. The version you have keeps working."
    return 0
  fi

  local actual
  actual="$(sha256sum "$tarball_file" | awk '{print $1}')"
  if [ "${actual,,}" != "${expected,,}" ]; then
    show_message "The ARCHIVEFLIX $display_latest download did not match its published SHA-256 checksum, so it was not installed. The version you have keeps working."
    return 0
  fi
  debug "checksum verified for $tarball_name"

  local extract_dir="$TMP_DIR/extract"
  mkdir -p "$extract_dir"
  if ! tar -xzf "$tarball_file" -C "$extract_dir" 2>/dev/null; then
    show_message "The ARCHIVEFLIX $display_latest download could not be opened, so it was not installed. The version you have keeps working."
    return 0
  fi

  local root
  root="$(find_release_root "$extract_dir" || true)"
  if [ -z "$root" ]; then
    show_message "The ARCHIVEFLIX $display_latest download did not contain a valid ARCHIVEFLIX app, so it was not installed. The version you have keeps working."
    return 0
  fi

  if ! install_files "$root"; then
    show_message "The ARCHIVEFLIX $display_latest update could not be installed. The version you have keeps working."
    return 0
  fi
  debug "installed $display_latest"

  if ask_user "ARCHIVEFLIX $display_latest is installed. Restart now to use the new version?"; then
    return 10
  fi
  return 11
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@" || exit $?
  exit 0
fi
