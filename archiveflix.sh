#!/bin/bash
# ARCHIVEFLIX launcher. Serves the installed app over loopback and opens
# it in the browser: app mode when a Chromium browser is available, a
# plain window otherwise. The loopback server is what lets the service
# worker run, so the installed copy caches itself for offline use and
# picks up updates the same way the web app does. The server stays
# running after the browser closes (a browser that is already open
# returns at once, so the launcher cannot tell when the window closes);
# it is a lightweight local server, bound to 127.0.0.1 only, and it stops
# on logout or restart. uninstall.sh stops it too.
# Installed by install.sh to ~/.local/share/archiveflix/. No terminal
# window stays open behind it.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=18471
URL="http://127.0.0.1:$PORT/index.html"
PID_FILE="$APP_DIR/.http-server.pid"

# Show a message the user can actually see. The desktop entry runs with
# Terminal=false, so a bare echo would vanish. stderr first (for anyone
# running from a terminal), then the best graphical option available.
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

# Ask what, if anything, is answering on the loopback port. Prints one
# word: "ours" (it serves this app's index.html byte for byte), "other"
# (something else answers there), or "free" (nothing answers).
probe_port() {
  python3 - "$URL" "$APP_DIR/index.html" <<'PYEOF' || echo free
import sys
import urllib.request
import urllib.error
url, local = sys.argv[1], sys.argv[2]
try:
    with urllib.request.urlopen(url, timeout=2) as response:
        body = response.read()
except urllib.error.HTTPError:
    print("other")
    sys.exit(0)
except Exception:
    print("free")
    sys.exit(0)
try:
    with open(local, "rb") as handle:
        ours = handle.read()
except OSError:
    print("other")
    sys.exit(0)
print("ours" if body == ours else "other")
PYEOF
}

# Start the loopback server in the background and wait until it serves
# our files. Returns 0 when the server is up, 1 otherwise.
start_server() {
  local i
  nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$APP_DIR" >/dev/null 2>&1 &
  echo "$!" > "$PID_FILE"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if [ "$(probe_port)" = "ours" ]; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

# Prefer the loopback server: it enables the service worker, so the
# installed copy caches offline and picks up updates. If python3 is
# missing or the server will not start, fall back to opening the files
# directly; the app still works, it just does not auto-update.
if command -v python3 >/dev/null 2>&1; then
  STATUS="$(probe_port)" || STATUS="free"
  case "$STATUS" in
    ours)
      ;;
    other)
      show_message "Cannot start because something else is already using port $PORT on this computer. Close that program and try again."
      exit 1
      ;;
    *)
      if ! start_server; then
        URL="file://$APP_DIR/index.html"
      fi
      ;;
  esac
else
  URL="file://$APP_DIR/index.html"
fi

for browser in google-chrome-stable google-chrome chromium chromium-browser brave-browser microsoft-edge-stable microsoft-edge; do
  if command -v "$browser" >/dev/null 2>&1; then
    exec "$browser" --app="$URL" --no-first-run
  fi
done

if command -v xdg-open >/dev/null 2>&1; then
  if xdg-open "$URL" >/dev/null 2>&1; then
    exit 0
  fi
fi

show_message "Could not find a web browser to open in. Install a web browser (for example Chromium or Firefox) and try again."
exit 1
