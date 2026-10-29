#!/bin/bash
# Installs the OF scripts catalog publisher on this Mac:
#   ~/.local/bin/of-scripts-catalog            the scanner (python, stdlib only)
#   ~/Library/LaunchAgents/com.ordinaryfolk.scripts-catalog.plist
#       runs it when any watched folder changes (launchd WatchPaths), every 6 h,
#       and once at login; log in ~/Library/Logs/of-scripts-catalog.log
#   ~/Library/Application Support/Ordinary Folk/Scripts Catalog/publish-secret
#       made here if missing; the hub needs the same value (set-hub-secret.sh)
# Safe to re-run after editing the catalog's folders (it rebuilds the watch list).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="$HOME/.local/bin"
CONF="$HOME/Library/Application Support/Ordinary Folk/Scripts Catalog"
LABEL=com.ordinaryfolk.scripts-catalog
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY=/usr/bin/python3

mkdir -p "$BIN" "$CONF" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
install -m 755 "$HERE/of-scripts-catalog.py" "$BIN/of-scripts-catalog"

if [ ! -s "$CONF/publish-secret" ]; then
  (umask 077; openssl rand -hex 32 > "$CONF/publish-secret")
  echo "New publish secret written to: $CONF/publish-secret"
  echo "Give the hub the same value: $HERE/set-hub-secret.sh"
fi

WATCH=$("$PY" "$BIN/of-scripts-catalog" --print-watch-paths)
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
  echo '<plist version="1.0"><dict>'
  echo "  <key>Label</key><string>$LABEL</string>"
  echo '  <key>ProgramArguments</key><array>'
  echo "    <string>$PY</string><string>$BIN/of-scripts-catalog</string>"
  echo '  </array>'
  echo '  <key>WatchPaths</key><array>'
  printf '%s\n' "$WATCH" | while IFS= read -r p; do
    [ -n "$p" ] && printf '    <string>%s</string>\n' "$(printf '%s' "$p" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g')"
  done
  echo '  </array>'
  echo '  <key>StartInterval</key><integer>21600</integer>'
  echo '  <key>RunAtLoad</key><true/>'
  echo '  <key>ThrottleInterval</key><integer>60</integer>'
  echo "  <key>StandardOutPath</key><string>$HOME/Library/Logs/of-scripts-catalog.log</string>"
  echo "  <key>StandardErrorPath</key><string>$HOME/Library/Logs/of-scripts-catalog.log</string>"
  echo '</dict></plist>'
} > "$PLIST"
plutil -lint "$PLIST" >/dev/null

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed $LABEL. Watching:"
printf '%s\n' "$WATCH" | sed 's/^/  /'
echo "Log: ~/Library/Logs/of-scripts-catalog.log"
