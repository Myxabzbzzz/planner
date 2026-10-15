# Деплой Planner

Три части деплоятся по-разному:

| Часть | Куда | Чем |
| --- | --- | --- |
| Mini App (`miniapp/`) | Vercel | `npx vercel --prod` из `miniapp/` — **руками** |
| Облако (`supabase/`) | Supabase | `scripts/deploy-supabase.sh` — **руками**, с подтверждением |
| ИИ-воркер (`worker/`) | домашний сервер (Linux) или ноутбук | `worker/scripts/install-linux.sh` / `install-agent.sh` (см. README) |

CI (`.github/workflows/ci.yml`) гоняется на каждый push и PR в `main`: сборка и
тесты Mini App, `pytest` воркера, Deno-тесты Edge Functions.

## ⚠️ Порядок имеет значение

**Сначала база, потом функции, в последнюю очередь Mini App.**

Mini App рассчитывает на функции, которых в старой базе нет. Самое неприятное —
удаление: в новой схеме оно мягкое, и под ним появляется «Отменить». Если
Mini App уже обновился, а миграции ещё нет, нажатие «Удалить» уйдёт в **старую**
функцию, которая удаляет насовсем, а «Отменить» не сработает. Это единственное
место, где неверный порядок стоит данных, — остальное просто деградирует
(«Уточнить» будет пустым, лимиты по категориям не загрузятся).

    1. scripts/deploy-supabase.sh      # миграции + Edge Functions
    2. push в main                     # Pages соберёт и выложит Mini App

Pages запускается автоматически на push в `main`, поэтому на первом деплое
**не включай Pages, пока не прогнал миграции**: Settings → Pages → Source
переключается вручную, и до этого workflow просто не публикует ничего.
Если Pages уже включён, а миграции накатить не успел — сними задачу в Actions
или сразу прогони скрипт.

Миграции написаны так, что старый Mini App с новой базой работает: добавляются
только новые функции и колонки, существующие сигнатуры сохранены. Поэтому
«база впереди» безопасно, а «Mini App впереди» — нет.

---

## 1. Что нужно один раз

### Supabase CLI

    brew install supabase/tap/supabase
    supabase login
    supabase projects list     # должен показать проект

Docker не обязателен:

- `supabase db push` и `migration list` работают без него;
- `supabase db diff` — нет, ему нужна shadow-база, скрипт этот шаг пропустит и скажет об этом
  (он же требует заранее сделанного `supabase link --project-ref <ref>`);
- функции без Docker собираются на стороне Supabase, скрипт сам добавит `--use-api`.

`migration list` и `db push` с `--project-ref` могут спросить пароль базы — он в
Dashboard → Settings → Database. Можно передать его флагом `-p`, но тогда он
останется в истории шелла.

### Vercel

Mini App живёт на Vercel, проект `miniapp` (привязка — `miniapp/.vercel/project.json`).
Адрес: `https://miniapp-seven-psi.vercel.app/` — он же в `MINIAPP_URL` и в
@BotFather → Bot Settings → Menu Button.

`VITE_API_URL` лежит в `miniapp/.env.production`, Vite подхватывает этот файл для
production-сборки сам. Это не секрет: адрес публичной функции `api`.

Рядом с приложением лежат публичные страницы из `miniapp/public/`: `terms.html`,
`privacy.html`, `pricing.html` — их же бот отдаёт по `/terms` и `/privacy`.

---

## 2. Обычный деплой

### Mini App

    cd miniapp && npx vercel --prod

### Облако

    SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh --dry-run   # посмотреть команды
    SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh             # по-настоящему

Если `SUPABASE_PROJECT_REF` не задан, ref берётся из `VITE_API_URL` в
`miniapp/.env.production` — в скрипте он не прописан.

Что делает скрипт по шагам:

1. проверяет, что `supabase` установлен и залогинен — иначе выходит с инструкцией;
2. показывает список миграций, `supabase migration list` и `supabase db push --dry-run`
   (плюс `db diff`, если есть Docker);
3. **требует набрать ровно `push <ref>`** — потому что дальше живая база с реальными данными;
4. `supabase db push`;
5. деплоит функции `api`, `bot-webhook`, `capture`, `notify`, `fx-sync`.
   Для каждой проверяет в `supabase/config.toml`, что там `verify_jwt = false`, и
   только тогда добавляет `--no-verify-jwt`;
6. печатает то, что сам сделать не может (секреты, вебхук, Vault).

Полезные флаги: `--dry-run`, `--skip-db`, `--skip-functions`, `--help`.

Скрипт не задаёт секреты и не ставит вебхук — там токены, они не должны
попадать ни в репозиторий, ни в историю команд скрипта.

### Воркер

На сервере (Linux):

    cd ~/planner && git pull && worker/scripts/install-linux.sh   # зависимости + перезапуск сервиса

На Mac:

    cd worker
    .venv/bin/pip install -e '.[dev]'     # если менялись зависимости
    launchctl kickstart -k gui/$(id -u)/com.planner.worker   # перезапуск агента

---

## 3. Секреты и переменные окружения

### Edge Functions — задаются через `supabase secrets set`

| Переменная | Кто читает | Зачем |
| --- | --- | --- |
| `SUPABASE_URL` | `api`, `bot-webhook`, `capture`, `notify`, `fx-sync` | подставляет платформа, задавать не надо |
| `SUPABASE_SERVICE_ROLE_KEY` | `api`, `bot-webhook`, `capture`, `notify`, `fx-sync` | подставляет платформа, задавать не надо |
| `TELEGRAM_BOT_TOKEN` | `api`, `bot-webhook`, `notify` | отправка сообщений, проверка `initData` |
| `TELEGRAM_WEBHOOK_SECRET` | `bot-webhook` | сверяется с `secret_token` вебхука |
| `ADMIN_TG_ID` | `bot-webhook` | кто админ |
| `OPEN_ACCESS` | `bot-webhook` | `"true"` — пускать всех, иначе только по приглашению |
| `MINIAPP_ORIGIN` | `api` | origin мини-аппа для CORS, например `https://miniapp-seven-psi.vercel.app`. Пока не задан — `api` отвечает `Access-Control-Allow-Origin: *`, как раньше. Только схема и домен, без пути и без слэша на конце |
| `MINIAPP_URL` | `bot-webhook`, `notify` | адрес Mini App для кнопки; без него кнопки нет |
| `CRON_SECRET` | `notify`, `fx-sync` | заголовок `x-cron-secret` у cron-вызовов |

Задать:

    supabase secrets set --project-ref <ref> \
      TELEGRAM_BOT_TOKEN=... \
      TELEGRAM_WEBHOOK_SECRET=... \
      ADMIN_TG_ID=... \
      OPEN_ACCESS=false \
      MINIAPP_ORIGIN=https://miniapp-seven-psi.vercel.app \
      CRON_SECRET=... \
      MINIAPP_URL=https://miniapp-seven-psi.vercel.app/

Проверить список имён: `supabase secrets list --project-ref <ref>`.

### Vault в базе — для cron

`supabase/migrations/20261001000002_cron.sql` ставит cron-задачу `fx-sync`, которая
читает два секрета из Vault. Один раз, в SQL Editor проекта:

    select vault.create_secret('https://<ref>.supabase.co', 'project_url');
    select vault.create_secret('<CRON_SECRET>', 'cron_secret');

`cron_secret` должен совпадать с `CRON_SECRET` у функций — иначе `fx-sync` будет
отвечать 401 и курсы перестанут обновляться.

### Mini App — время сборки

| Переменная | Где | Зачем |
| --- | --- | --- |
| `VITE_API_URL` | `miniapp/.env.production` (в репозитории) | адрес функции `api`; читается в `miniapp/src/App.tsx` |

### Воркер — `worker/.env` (шаблон в `worker/.env.example`)

Обязательные (`worker/planner_worker/config.py` упадёт без них):

| Переменная | Зачем |
| --- | --- |
| `SUPABASE_URL` | куда ходить за очередью |
| `SUPABASE_SERVICE_ROLE_KEY` | доступ в базу |
| `TELEGRAM_BOT_TOKEN` | ответы пользователю |

Необязательные, со значениями по умолчанию: `OLLAMA_URL`, `OLLAMA_MODEL`,
`OLLAMA_KEEP_ALIVE` (сколько держать модель в памяти: на Linux-сервере всегда, `-1`; на Mac `30m`),
`VISION_MODEL` (модель для фото чеков, по умолчанию `qwen2.5vl:7b`; `install-linux.sh` скачивает её сам),
`WHISPER_MODEL`, `WHISPER_BACKEND` (`mlx` на Mac, `faster` на Linux — выбирается сам),
`USE_LAYA`, `LAYA_THRESHOLD`, `WORKER_ID`, `POLL_INTERVAL`,
`WORKER_INBOX` (`false` — воркер только подписывает быстрые команды; так оставляют Mac рядом с сервером).

### Telegram-вебхук

    curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
      -d "url=https://<ref>.supabase.co/functions/v1/bot-webhook" \
      -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"

Проверить: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

### GitHub

Один необязательный secret — `NTFY_TOPIC` для `deploy-notify.yml`: после зелёного CI
он будит автодеплой воркера на домашнем сервере. Без него сервер подхватит обновление по таймеру.

---

## 4. Откат

### Mini App

Самое быстрое — Vercel Dashboard → проект `miniapp` → Deployments → прошлый
деплой → **Promote to Production** (или `npx vercel rollback`). Либо `git revert`
проблемного коммита и снова `npx vercel --prod`.

### Edge Functions

Откатить коммит и задеплоить снова только функции:

    git revert <sha> && git push
    SUPABASE_PROJECT_REF=<ref> scripts/deploy-supabase.sh --skip-db

В Dashboard у каждой функции есть история версий — там же можно посмотреть,
что именно сейчас задеплоено.

### База

Автоматического отката нет и быть не может: `db push` применяет миграции вперёд.
Поэтому:

- перед деплоем БД — Dashboard → Database → Backups, убедиться, что бэкап свежий,
  или нажать там же создание нового;
- откат делается **новой миграцией**, которая отменяет изменения, а не
  редактированием уже применённой (иначе разъедется история миграций);
- если всё совсем плохо — восстановление из бэкапа в Dashboard, с простоем.

Именно поэтому скрипт требует набрать `push <ref>` руками.

---

## 5. Чеклист первого деплоя

1. `supabase login`, проверить `supabase projects list`.
2. `scripts/deploy-supabase.sh --dry-run` — посмотреть, что будет.
3. Бэкап базы в Dashboard.
4. `scripts/deploy-supabase.sh` → набрать `push <ref>`.
5. `supabase secrets set ...` — все переменные из таблицы выше, кроме `MINIAPP_URL`.
6. Vault: `project_url` и `cron_secret`.
7. `cd miniapp && npx vercel --prod` — первый деплой Mini App.
8. `supabase secrets set MINIAPP_URL=https://miniapp-seven-psi.vercel.app/` и то же в @BotFather.
9. `setWebhook` с `secret_token`.
10. Воркер: `worker/.env`, `worker/scripts/install-agent.sh`.
11. Написать боту `/start` и открыть Mini App.
