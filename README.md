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
