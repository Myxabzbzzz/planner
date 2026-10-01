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
