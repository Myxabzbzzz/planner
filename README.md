# Planner

Telegram-бот + Mini App «вся жизнь в одном месте» с локальным ИИ.

- Спека: `docs/superpowers/specs/2026-10-01-planner-design.md`
- Облако: `supabase/` (миграции, Edge Functions)
- ИИ-воркер (ноутбук): `worker/`

## Локальная разработка

    supabase start          # нужен Docker
    supabase test db        # pgTAP
    deno test --allow-env --allow-net supabase/functions/
    cd worker && .venv/bin/pytest

## Запуск воркера

    cd worker
    cp .env.example .env      # заполнить SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN
    .venv/bin/python -m planner_worker.main

Пока воркер не запущен, бот отвечает «⏳ Принял, разберу, когда ИИ проснётся» и копит очередь.

## Постоянный запуск воркера

    worker/scripts/install-agent.sh     # старт при входе, перезапуск при падении
    tail -f ~/Library/Logs/planner-worker.log
    worker/scripts/uninstall-agent.sh   # убрать

Пока Mac на зарядке, он не засыпает (`caffeinate -s`). На батарее с закрытой крышкой Mac уснёт —
бот ответит «разберу, когда ИИ проснётся», очередь разберётся после пробуждения.

## Двойной тап по задней крышке

В боте: ⚙️ Настройки → 📲 Двойной тап — пошаговая инструкция с личным токеном для приложения «Команды».

## Деплой

Полный runbook — [docs/deploy.md](docs/deploy.md).

Коротко:

- **Mini App** едет на GitHub Pages сам: push в `main` → `.github/workflows/pages.yml`.
  Pages отдаёт приложение из `/<repo>/`, поэтому workflow передаёт Vite правильный
  `base` на сборке. Адрес приложения потом нужно положить в `MINIAPP_URL`.
- **Облако** (миграции + Edge Functions) деплоится руками:

      SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh --dry-run
      SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh

  Перед `db push` скрипт покажет, что будет применено, и попросит набрать
  подтверждение — база живая.
- **Секреты, вебхук Telegram и секреты в Vault** скрипт не ставит: что именно
  задать и кто это читает — в [docs/deploy.md](docs/deploy.md).

CI (`.github/workflows/ci.yml`) на каждый push и PR в `main` собирает и тестирует
Mini App, гоняет `pytest` воркера и Deno-тесты Edge Functions.

## Лицензия

Все права защищены. Код опубликован только для портфолио, использовать его без разрешения автора нельзя. Подробности в [LICENSE](LICENSE).

## Проверка оплаты без денег (тестовая среда Telegram)

В тестовой среде Telegram звёзды бесплатные. Тестовый бот работает локально, прод не трогается.

1. Тестовый аккаунт: в Telegram для macOS 10 раз нажми на иконку «Настройки» → в отладочном меню ⌘+клик «Add Account» → войти по номеру.
2. В тестовом аккаунте: @BotFather → `/newbot` → токен.
3. `cp supabase/functions/.env.test.example supabase/functions/.env.test` и впиши токен.
4. Терминал 1 (нужен `supabase start`): `supabase functions serve --env-file supabase/functions/.env.test --no-verify-jwt`
5. Терминал 2: `deno run --allow-net --allow-env --env-file=supabase/functions/.env.test scripts/tg-test-bot.ts`
6. В тестовом Telegram: `/start` → валюта → `/pro` → оплатить.
