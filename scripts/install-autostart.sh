#!/bin/sh
# Start Koala Grove at login (macOS LaunchAgent) and add a "Koala Grove" app that opens it.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
LABEL=com.koala-grove.server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/Koala Grove.app"
NODE=$(command -v node)
PORT=${PORT:-4317}
# launchd starts with a bare PATH; keep node's and claude's folders on it.
CLAUDE_DIR=$(dirname "$(command -v claude)")
NODE_DIR=$(dirname "$NODE")
# and Docker's, so each koala's computer (the sealed box it tests what it makes in) works
DOCKER_DIR=$(dirname "$(command -v docker || echo /usr/local/bin/docker)")

mkdir -p "$ROOT/logs" "$HOME/Library/LaunchAgents" "$HOME/Applications"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/server.js</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CLAUDE_DIR:$NODE_DIR:$DOCKER_DIR:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$ROOT/logs/server.log</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/server.log</string>
</dict>
</plist>
PLIST

# The older Agent HQ login item served the same port; take it out first.
launchctl bootout "gui/$(id -u)/com.agent-hq.server" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.agent-hq.server.plist"
rm -rf "$HOME/Applications/Agent HQ.app"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

rm -rf "$APP"
osacompile -o "$APP" -e "open location \"http://127.0.0.1:$PORT\""

echo "Koala Grove starts at login and is running now on http://127.0.0.1:$PORT"
echo "Open it with: $APP (drag it to the Dock)"
echo "Logs: $ROOT/logs/server.log"
