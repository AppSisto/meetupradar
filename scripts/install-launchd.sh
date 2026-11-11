#!/bin/bash
# Zapne (nebo s --remove vypne) plánovaný lokální sync: 6:00, 10:00, 14:00 a 18:00.

set -euo pipefail
LABEL=cz.appsisto.meetupradar.sync
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "--remove" ]; then
  rm -f "$PLIST"
  echo "Plánovaný sync vypnut."
  exit 0
fi

slots=""
for hour in 6 10 14 18; do
  slots+="    <dict><key>Hour</key><integer>$hour</integer><key>Minute</key><integer>0</integer></dict>
"
done

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$ROOT/scripts/local-sync.sh</string></array>
  <key>StartCalendarInterval</key>
  <array>
$slots  </array>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Plánovaný sync zapnut: $PLIST"
