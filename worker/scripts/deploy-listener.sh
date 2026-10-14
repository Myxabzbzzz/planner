#!/usr/bin/env bash
# Слушает приватный топик ntfy.sh, куда GitHub пишет после зелёного CI по main
# (.github/workflows/deploy-notify.yml), и сразу запускает автодеплой.
# Сообщению не доверяем: autodeploy.sh сам проверяет CI на GitHub, так что чужое сообщение
# в топик в худшем случае вызовет лишнюю проверку. Связь оборвалась — systemd перезапустит.
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
TOPIC="$(grep -E '^DEPLOY_NTFY_TOPIC=' "$ENV_FILE" | cut -d= -f2- || true)"
[ -n "$TOPIC" ] || { echo "Нет DEPLOY_NTFY_TOPIC в $ENV_FILE"; exit 1; }

echo "Слушаю ntfy"
curl -fsSN "https://ntfy.sh/$TOPIC/json" | while read -r line; do
  [ "$(jq -r .event <<<"$line")" = message ] || continue   # open / keepalive
  echo "CI зелёный по $(jq -r '.message[0:7]' <<<"$line") — запускаю автодеплой"
  # идущий деплой мог уже взять прошлый коммит — start на него «склеился» бы, и этот потерялся
  while [ "$(systemctl --user show -p ActiveState --value planner-autodeploy.service)" = activating ]; do sleep 5; done
  systemctl --user start --no-block planner-autodeploy.service
done
