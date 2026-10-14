#!/usr/bin/env bash
# Ставит ИИ-воркер на домашний сервер с Arch / Omarchy:
#   Ollama (на видеокарте NVIDIA, если она есть) + модель, окружение Python,
#   systemd-сервис пользователя, который стартует при включении без входа в систему
#   и перезапускается при падении. По желанию — запрет сна, чтобы сервер не засыпал.
# Повторный запуск безопасен: так же обновляются зависимости после git pull.
set -euo pipefail

WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT="planner-worker.service"
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ask() { read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[YyДд] ]]; }

[ "$(id -u)" -ne 0 ] || { echo "Запусти от своего пользователя, не через sudo — sudo попрошу сам, где нужно."; exit 1; }
command -v pacman >/dev/null || { echo "Скрипт для Arch / Omarchy (нужен pacman)."; exit 1; }
[ -f "$WORKER_DIR/.env" ] || { echo "Нет $WORKER_DIR/.env — перенеси его с Mac (см. README) и запусти снова."; exit 1; }

GPU=0
if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then
  GPU=1
  say "Видеокарта: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader | head -1)"
else
  say "Видеокарта NVIDIA не найдена (или нет драйвера) — всё пойдёт на процессоре, медленнее."
fi

say "Пакеты: uv, Ollama"
if [ "$GPU" = 1 ]; then OLLAMA_PKG=ollama-cuda; else OLLAMA_PKG=ollama; fi
# sudo — только если чего-то нет: повторный запуск (обновление) пароль не спрашивает
pacman -Q uv jq "$OLLAMA_PKG" >/dev/null 2>&1 || sudo pacman -S --needed --noconfirm uv jq "$OLLAMA_PKG"
systemctl is-enabled --quiet ollama.service && systemctl is-active --quiet ollama.service \
  || sudo systemctl enable --now ollama.service

say "Жду, пока Ollama поднимется"
for _ in $(seq 1 30); do curl -fsS http://localhost:11434/api/version >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://localhost:11434/api/version >/dev/null || { echo "Ollama не отвечает: journalctl -u ollama -e"; exit 1; }

MODEL="$(grep -E '^OLLAMA_MODEL=' "$WORKER_DIR/.env" | cut -d= -f2- || true)"
MODEL="${MODEL:-qwen3:8b}"
say "Модель $MODEL (первый раз — несколько ГБ)"
ollama pull "$MODEL"

say "Окружение Python"
cd "$WORKER_DIR"
[ -x .venv/bin/python ] || uv venv --python 3.12 .venv
if [ "$GPU" = 1 ]; then uv pip install --python .venv/bin/python -e '.[cuda]'; else uv pip install --python .venv/bin/python -e .; fi

# faster-whisper ищет библиотеки CUDA/cuDNN в системе — показываем ему те, что поставились в .venv
# (nvidia.*.lib — пакеты без __init__, у них нет __file__, только __path__)
LD_PATH=""
if [ "$GPU" = 1 ]; then
  LD_PATH="$(.venv/bin/python -c 'import nvidia.cublas.lib as b, nvidia.cudnn.lib as d; print(list(b.__path__)[0] + ":" + list(d.__path__)[0])')"
fi

# пульс воркера подписан его именем — чтобы в логах было видно, что работает сервер, а не ноутбук
if grep -qE '^WORKER_ID=laptop$' .env; then
  sed -i "s/^WORKER_ID=laptop$/WORKER_ID=$(hostname)/" .env
  say "WORKER_ID в .env: laptop → $(hostname)"
fi

say "Сервис $UNIT"
mkdir -p "$(dirname "$UNIT_FILE")"
cat > "$UNIT_FILE" <<EOF
[Unit]
# сети и Ollama на старте может ещё не быть — воркер упадёт и через 10 секунд попробует снова
Description=Planner AI worker

[Service]
WorkingDirectory=$WORKER_DIR
ExecStart=$WORKER_DIR/.venv/bin/python -m planner_worker.main
Environment=PYTHONUNBUFFERED=1
Environment=LD_LIBRARY_PATH=$LD_PATH
Restart=always
RestartSec=10
# по SIGTERM воркер дорабатывает текущее сообщение (голосовое — до пары минут), потом выходит
TimeoutStopSec=300

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable "$UNIT"
systemctl --user restart "$UNIT"

# Автодеплой: сервер сам берёт main, если CI по нему зелёный (scripts/autodeploy.sh).
# Нужен git-клон репозитория — копия, перенесённая rsync, обновляться не умеет.
# С DEPLOY_NTFY_TOPIC в .env — сразу по сигналу GitHub через ntfy.sh, таймер раз в 15 минут лишь подстраховка;
# без него — проверка раз в 2 минуты.
if git -C "$WORKER_DIR/.." rev-parse --git-dir >/dev/null 2>&1; then
  NTFY_TOPIC="$(grep -E '^DEPLOY_NTFY_TOPIC=' "$WORKER_DIR/.env" | cut -d= -f2- || true)"
  if [ -n "$NTFY_TOPIC" ]; then EVERY=15min; else EVERY=2min; fi
  say "Автодеплой (planner-autodeploy.timer, раз в $EVERY)"
  cat > "$(dirname "$UNIT_FILE")/planner-autodeploy.service" <<EOF
[Unit]
Description=Planner: deploy fresh main when CI is green

[Service]
Type=oneshot
ExecStart=$WORKER_DIR/scripts/autodeploy.sh
EOF
  cat > "$(dirname "$UNIT_FILE")/planner-autodeploy.timer" <<EOF
[Unit]
Description=Planner: check GitHub for a green main every $EVERY

[Timer]
OnBootSec=2min
OnUnitInactiveSec=$EVERY

[Install]
WantedBy=timers.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now planner-autodeploy.timer
  systemctl --user restart planner-autodeploy.timer   # новый интервал

  if [ -n "$NTFY_TOPIC" ]; then
    say "Мгновенный деплой после CI (planner-deploy-listener)"
    cat > "$(dirname "$UNIT_FILE")/planner-deploy-listener.service" <<EOF
[Unit]
Description=Planner: deploy right after green CI (signal from GitHub via ntfy.sh)

[Service]
ExecStart=$WORKER_DIR/scripts/deploy-listener.sh
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable planner-deploy-listener.service
    systemctl --user restart planner-deploy-listener.service
  fi
else
  say "Автодеплой пропущен: $(cd "$WORKER_DIR/.." && pwd) — не git-клон (нужен git clone https://github.com/Myxabzbzzz/planner)"
fi
# без этого сервисы пользователя живут, только пока он залогинен
[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ] || sudo loginctl enable-linger "$USER"

if [ "$(systemctl is-enabled suspend.target 2>/dev/null)" = masked ]; then
  echo "Сон уже запрещён."
elif ask "Запретить серверу засыпать (sleep/suspend/hibernate)? Для сервера — да."; then
  sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
fi
if ls /proc/acpi/button/lid/*/state >/dev/null 2>&1 && ask "Это ноутбук. Не засыпать при закрытой крышке?"; then
  sudo mkdir -p /etc/systemd/logind.conf.d
  printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' \
    | sudo tee /etc/systemd/logind.conf.d/planner-no-lid-sleep.conf >/dev/null
  echo "Вступит в силу после перезагрузки."
fi

say "Готово"
echo "Статус:     systemctl --user status $UNIT"
echo "Лог:        journalctl --user -u $UNIT -f"
echo "Обновления: сами после зелёного CI, лог — journalctl --user -u planner-autodeploy -e"
echo "Удалить:    systemctl --user disable --now $UNIT planner-autodeploy.timer && rm $UNIT_FILE"
sleep 3
systemctl --user --no-pager status "$UNIT" | head -5 || true
