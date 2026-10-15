# Planner

Telegram-бот + Mini App «вся жизнь в одном месте» с локальным ИИ.

- Спека: `docs/superpowers/specs/2026-10-01-planner-design.md`
- Облако: `supabase/` (миграции, Edge Functions)
- ИИ-воркер (ноутбук): `worker/`

## Локальная разработка

    supabase start          # нужен Docker
    supabase test db        # pgTAP
    deno test --allow-env --allow-net --allow-read supabase/functions/
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

## Воркер на домашнем сервере (Linux)

Чтобы ноутбук можно было закрывать и выключать, воркер живёт на сервере с Arch / Omarchy.
Он ходит в Supabase и Telegram сам, поэтому белый IP и открытые порты не нужны.
Голос там распознаёт faster-whisper (на видеокарте NVIDIA, без неё — на процессоре).

На сервере:

    sudo pacman -S --needed git openssh
    git clone https://github.com/Myxabzbzzz/planner ~/planner   # именно клон — по нему работает автодеплой
    sudo systemctl enable --now sshd              # чтобы перенести .env с Mac

На Mac — перенести секреты (`<user>@<server>` — пользователь и адрес сервера в домашней сети):

    scp worker/.env <user>@<server>:~/planner/worker/.env

Снова на сервере:

    ~/planner/worker/scripts/install-linux.sh     # Ollama, модель, окружение, systemd-сервис
    journalctl --user -u planner-worker -f        # лог; ждём строку «ready»

Пришли боту «кофе 100» и голосовое — ответить должен уже сервер. Два воркера одновременно
не мешают друг другу (очередь отдаёт каждую запись одному), так что ноутбук выключается после проверки.

**Быстрая команда для iPhone.** Файл `.shortcut` подписывает только macOS (`shortcuts sign`),
на Linux такие запросы воркер не берёт. Если оставить на Mac воркер только для них —
в `worker/.env` на Mac `WORKER_INBOX=false`, затем `launchctl kickstart -k gui/$(id -u)/com.planner.worker` —
файл придёт, как только ноутбук будет включён. Иначе — `worker/scripts/uninstall-agent.sh`.

**Обновления выкатываются сами.** Когда CI по `main` зелёный, GitHub (`deploy-notify.yml`) шлёт сигнал в приватный
топик ntfy.sh, сервер его слушает (`planner-deploy-listener`) и сразу делает `git pull` и перезапускает воркер (тот сначала дорабатывает
текущее сообщение). Если воркер за 3 минуты не написал «ready» — откат на прежний коммит, и этот коммит больше
не берётся. Красный или ещё идущий CI — сервер ничего не трогает. Лог: `journalctl --user -u planner-autodeploy -e`.
Раннер GitHub на сервере не используется намеренно: репозиторий публичный, чужой PR выполнил бы на нём код.
Если поменялся сам `install-linux.sh` (systemd-юнит, пакеты) — его нужно перезапустить вручную.
Сигналу сервер не доверяет — статус CI проверяет сам, так что чужое сообщение в топик ничего не выкатит.
Если сигнал потерялся (сервер был выключен) — подстрахует таймер `planner-autodeploy.timer` раз в 15 минут.
Настройка: случайное имя топика в секрет репозитория `NTFY_TOPIC` и в `worker/.env` сервера как
`DEPLOY_NTFY_TOPIC`, затем `worker/scripts/install-linux.sh`. Без топика сервер проверяет GitHub раз в 2 минуты.

## Двойной тап по задней крышке

В боте: ⚙️ Настройки → 📲 Двойной тап — пошаговая инструкция с личным токеном для приложения «Команды».

## Деплой

Полный runbook — [docs/deploy.md](docs/deploy.md).

Коротко:

- **Mini App** выкатывается на Vercel руками: `cd miniapp && npx vercel --prod`.
  Адрес приложения — в `MINIAPP_URL`.
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
