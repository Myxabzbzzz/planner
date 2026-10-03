#!/usr/bin/env bash
# Ставит ИИ-воркер как launchd-агент: старт при входе, перезапуск при падении,
# Mac не засыпает, пока подключён к зарядке (caffeinate -s).
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.planner.worker"
PLIST="${PLANNER_PLIST_OUT:-$HOME/Library/LaunchAgents/$LABEL.plist}"
LOG="$HOME/Library/Logs/planner-worker.log"

[ -x "$WORKER_DIR/.venv/bin/python" ] || { echo "Нет $WORKER_DIR/.venv — сначала создай окружение (см. README)"; exit 1; }
[ -f "$WORKER_DIR/.env" ] || { echo "Нет $WORKER_DIR/.env — скопируй .env.example и заполни"; exit 1; }

mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>$WORKER_DIR/.venv/bin/python</string>
    <string>-m</string>
    <string>planner_worker.main</string>
  </array>
  <key>WorkingDirectory</key><string>$WORKER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>PYTHONUNBUFFERED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

if [ -n "${PLANNER_PLIST_OUT:-}" ]; then
  echo "plist записан в $PLIST (launchctl не трогали)"
  exit 0
fi

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово: воркер запущен и будет стартовать сам. Лог: tail -f $LOG"
