#!/usr/bin/env bash
set -euo pipefail
LABEL="com.planner.worker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Воркер остановлен и убран из автозапуска."
