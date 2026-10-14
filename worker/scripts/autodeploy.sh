#!/usr/bin/env bash
# Автодеплой воркера на сервере: запускается таймером planner-autodeploy.timer раз в 2 минуты.
# Берёт свежий main с GitHub, только когда по этому коммиту CI зелёный; если воркер после
# обновления не поднялся — откатывает на прежний коммит и больше этот коммит не берёт.
# Всё тело — в функции: git pull может переписать этот же файл, пока bash его читает.
set -euo pipefail

main() {
  local repo unit api state cur new
  repo="$(cd "$(dirname "$0")/../.." && pwd)"
  unit="planner-worker.service"
  api="https://api.github.com/repos/${PLANNER_REPO:-Myxabzbzzz/planner}/actions/workflows/ci.yml/runs"
  state="$repo/.git/autodeploy"   # rejected-<sha> — откаченные коммиты, red-<sha> — уже сказали про красный CI
  mkdir -p "$state"
  cd "$repo"

  exec 9>"$state/lock"
  flock -n 9 || exit 0   # прошлый запуск ещё идёт

  git fetch -q origin main || exit 0   # нет сети — попробую в следующий раз
  cur="$(git rev-parse HEAD)"
  new="$(git rev-parse origin/main)"
  [ "$cur" != "$new" ] || exit 0
  [ ! -e "$state/rejected-$new" ] || exit 0

  # статус CI по ровно этому коммиту (репозиторий публичный — токен не нужен)
  local verdict
  verdict="$(curl -fsS --max-time 20 "$api?head_sha=$new&event=push&per_page=1" \
    | jq -r '.workflow_runs[0] | if . == null then "none" else "\(.status)/\(.conclusion)" end')" || exit 0
  case "$verdict" in
    completed/success) ;;
    completed/*)   # не отвергаем насовсем: CI могут перезапустить, и он позеленеет
      [ -e "$state/red-$new" ] || echo "CI по ${new:0:7} не прошёл ($verdict) — не выкатываю"
      touch "$state/red-$new"; exit 0 ;;
    *) exit 0 ;;   # CI ещё идёт или не начался — проверю в следующий раз
  esac

  local changed
  changed="$(git diff --name-only "$cur" "$new")"
  echo "Выкатываю ${cur:0:7} → ${new:0:7}: $(git log -1 --format=%s "$new")"
  git merge -q --ff-only "$new"

  if ! grep -q '^worker/' <<<"$changed"; then
    echo "Воркер не менялся — перезапуск не нужен"
    exit 0
  fi
  if grep -q '^worker/pyproject.toml$' <<<"$changed"; then install_deps; fi

  if restart_and_wait "$unit"; then
    echo "Готово: воркер работает на ${new:0:7}"
    return 0
  fi

  echo "Воркер на ${new:0:7} не поднялся — откатываю на ${cur:0:7}" >&2
  touch "$state/rejected-$new"
  git reset -q --hard "$cur"
  if grep -q '^worker/pyproject.toml$' <<<"$changed"; then install_deps; fi
  restart_and_wait "$unit" || echo "И на ${cur:0:7} воркер не поднялся — нужен человек" >&2
  exit 1
}

install_deps() {
  echo "Зависимости изменились — обновляю окружение"
  local extra=""
  nvidia-smi -L >/dev/null 2>&1 && extra="[cuda]"
  (cd worker && uv pip install -q --python .venv/bin/python -e ".$extra")
}

# Перезапуск и ожидание строки «ready» в логе: модели прогреваются ~10 с, даём 3 минуты.
restart_and_wait() {
  local unit="$1" since
  since="$(date '+%Y-%m-%d %H:%M:%S')"
  systemctl --user restart "$unit"
  for _ in $(seq 1 36); do
    sleep 5
    if journalctl --user -u "$unit" --since "$since" --no-pager -o cat | grep -q 'planner_worker: ready'; then
      return 0
    fi
  done
  return 1
}

main "$@"
