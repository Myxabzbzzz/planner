#!/usr/bin/env bash
#
# Ручной деплой облачной части Planner: миграции БД + Edge Functions.
# Запускает владелец проекта. Скрипт ничего не делает молча:
# перед `db push` требуется явное подтверждение, потому что это живая база.
#
# Использование:
#   SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh [--dry-run] [--skip-db] [--skip-functions]
#
# Если SUPABASE_PROJECT_REF не задан, берётся ref по умолчанию — он вытаскивается
# из miniapp/.env.production (VITE_API_URL), а не прописан в скрипте.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/miniapp/.env.production"
CONFIG_TOML="$REPO_ROOT/supabase/config.toml"

DRY_RUN=0
SKIP_DB=0
SKIP_FUNCTIONS=0

# Функции из supabase/config.toml, где verify_jwt = false,
# деплоятся с --no-verify-jwt. Список проверяется против config.toml ниже.
FUNCTIONS=(api bot-webhook capture notify fx-sync)

die() { printf '\033[31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }
# Мало, чтобы был установлен docker CLI: без запущенного демона db diff и сборка функций падают.
docker_up() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
scripts/deploy-supabase.sh — деплой миграций и Edge Functions в облако Supabase.

  --dry-run          только печатает команды, ничего не выполняет
  --skip-db          не трогать миграции, только функции
  --skip-functions   только миграции, без функций
  -h, --help         эта справка

Переменные окружения:
  SUPABASE_PROJECT_REF   ref проекта Supabase (по умолчанию — из miniapp/.env.production)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --skip-db) SKIP_DB=1 ;;
    --skip-functions) SKIP_FUNCTIONS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) die "неизвестный аргумент: $1 (см. --help)" ;;
  esac
  shift
done

# --- Выполнение команд ------------------------------------------------------
# В --dry-run печатаем команду и не запускаем её.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '  \033[90m$\033[0m %s\n' "$*"
  else
    printf '  \033[90m$\033[0m %s\n' "$*"
    "$@"
  fi
}

# --- Проверки окружения -----------------------------------------------------
check_cli() {
  if ! command -v supabase >/dev/null 2>&1; then
    die "не найден Supabase CLI.
  Установи:  brew install supabase/tap/supabase
  Потом:     supabase login"
  fi

  # `supabase projects list` без логина падает — это и есть проверка авторизации.
  if ! supabase projects list >/dev/null 2>&1; then
    die "Supabase CLI не авторизован (или нет сети).
  Выполни:   supabase login
  Проверь:   supabase projects list"
  fi
}

# Ref по умолчанию: из VITE_API_URL в miniapp/.env.production
# (https://<ref>.supabase.co/functions/v1/api).
default_project_ref() {
  [[ -f $ENV_FILE ]] || return 1
  sed -n 's#^VITE_API_URL=https://\([a-z0-9]*\)\.supabase\.co.*#\1#p' "$ENV_FILE" | head -n1
}

# Проверяем, что для функции в config.toml действительно verify_jwt = false.
jwt_disabled() {
  local fn="$1"
  awk -v fn="$fn" '
    $0 ~ "^\\[functions\\." fn "\\]$" { inblock = 1; next }
    /^\[/ { inblock = 0 }
    inblock && /verify_jwt[[:space:]]*=[[:space:]]*false/ { found = 1 }
    END { exit found ? 0 : 1 }
  ' "$CONFIG_TOML"
}

# --- Подтверждение ----------------------------------------------------------
confirm_db_push() {
  local ref="$1" answer
  printf '\n\033[31m────────────────────────────────────────────────────────────\033[0m\n'
  printf '  ВНИМАНИЕ: следующий шаг — supabase db push в проект %s.\n' "$ref"
  printf '  Это живая база с реальными данными. Миграции необратимы.\n'
  printf '  Убедись, что выше ты посмотрел diff и список миграций.\n'
  printf '\033[31m────────────────────────────────────────────────────────────\033[0m\n\n'
  printf 'Чтобы продолжить, набери ровно: push %s\n> ' "$ref"
  read -r answer
  [[ $answer == "push $ref" ]] || die "подтверждение не совпало — деплой БД отменён."
}

# --- Основной сценарий ------------------------------------------------------
main() {
  if [[ $DRY_RUN -eq 1 ]]; then
    warn "DRY RUN: ни одна команда не будет выполнена."
  else
    check_cli
  fi

  local ref="${SUPABASE_PROJECT_REF:-}"
  if [[ -z $ref ]]; then
    ref="$(default_project_ref || true)"
    [[ -n $ref ]] || die "не удалось определить ref проекта.
  Задай его явно:  SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh"
    info "SUPABASE_PROJECT_REF не задан, беру ref из miniapp/.env.production: $ref"
  else
    info "Проект: $ref"
  fi

  if [[ $SKIP_DB -eq 0 ]]; then
    info "Миграции в репозитории (supabase/migrations):"
    if [[ $DRY_RUN -eq 1 ]]; then
      printf '  \033[90m$\033[0m ls -1 supabase/migrations\n'
    else
      ls -1 "$REPO_ROOT/supabase/migrations"
    fi

    info "Что уже применено в облаке, а что нет:"
    run supabase migration list --project-ref "$ref"

    info "Что именно применил бы push (db push --dry-run, Docker не нужен):"
    run supabase db push --project-ref "$ref" --dry-run

    # db diff строит shadow-базу в Docker. Без Docker шаг бессмысленен — пропускаем.
    if docker_up; then
      info "Расхождение схемы с облаком (supabase db diff, нужен Docker):"
      run supabase db diff --linked
    else
      warn "Docker не запущен — supabase db diff пропущен (ему нужна shadow-база)."
      warn "Списка выше (migration list + db push --dry-run) для деплоя достаточно."
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
      printf '\n  \033[90m#\033[0m здесь скрипт потребовал бы набрать ровно: push %s\n' "$ref"
      run supabase db push --project-ref "$ref"
    else
      confirm_db_push "$ref"
      run supabase db push --project-ref "$ref"
    fi
  else
    warn "--skip-db: миграции пропущены."
  fi

  if [[ $SKIP_FUNCTIONS -eq 0 ]]; then
    info "Деплой Edge Functions:"
    # Без Docker CLI умеет собирать функции на стороне Supabase — --use-api.
    local no_docker=0
    if ! docker_up; then
      warn "Docker не запущен — функции собираю через --use-api (сборка на стороне Supabase)."
      no_docker=1
    fi

    local fn
    for fn in "${FUNCTIONS[@]}"; do
      # Массив никогда не пустой (в нём всегда --project-ref), поэтому
      # безопасен при set -u даже в bash 3.2 из macOS.
      local -a args=(--project-ref "$ref")
      if jwt_disabled "$fn"; then
        args+=(--no-verify-jwt)
      else
        warn "в config.toml у $fn нет verify_jwt = false — деплою с проверкой JWT"
      fi
      [[ $no_docker -eq 1 ]] && args+=(--use-api)

      run supabase functions deploy "$fn" "${args[@]}"
      unset args
    done
  else
    warn "--skip-functions: функции пропущены."
  fi

  post_deploy_notes "$ref"
}

# --- Что скрипт сделать не может -------------------------------------------
post_deploy_notes() {
  local ref="$1"
  cat <<EOF

==> Осталось сделать руками (скрипт этого не делает — здесь секреты):

1. Секреты Edge Functions (их читают сами функции через Deno.env.get):
     supabase secrets set --project-ref $ref \\
       TELEGRAM_BOT_TOKEN=... \\
       TELEGRAM_WEBHOOK_SECRET=... \\
       ADMIN_TG_ID=... \\
       OPEN_ACCESS=false \\
       MINIAPP_ORIGIN=https://<user>.github.io \\
       CRON_SECRET=... \\
       MINIAPP_URL=https://<user>.github.io/<repo>/
   SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY платформа подставляет сама.

2. MINIAPP_URL — адрес Mini App на GitHub Pages. Без него бот и notify
   не покажут кнопку открытия приложения. Его же надо прописать в
   @BotFather (Bot Settings → Menu Button).

3. Вебхук Telegram (TELEGRAM_WEBHOOK_SECRET должен совпасть с секретом выше):
     curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \\
       -d "url=https://$ref.supabase.co/functions/v1/bot-webhook" \\
       -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

4. Секреты в Vault — их требует supabase/migrations/20261001000002_cron.sql
   (cron-задача fx-sync). В SQL Editor проекта один раз:
     select vault.create_secret('https://$ref.supabase.co', 'project_url');
     select vault.create_secret('<CRON_SECRET>', 'cron_secret');
   CRON_SECRET тут должен совпадать с тем, что задан в секретах функций.

5. Воркер на ноутбуке читает свой worker/.env (см. worker/.env.example):
   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN.

Подробности и откат — docs/deploy.md
EOF
}

main "$@"
