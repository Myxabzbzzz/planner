# Мониторинг и нагрузочный тест (локально)

Всё здесь работает только с локальным стеком (`supabase start`). Прод это не трогает.

## Запуск

```sh
supabase start                                                # если запущен другой проект: supabase stop --project-id <id>
supabase functions serve --env-file loadtest/functions.env    # отдельный терминал, держать открытым
docker compose -f monitoring/docker-compose.yml up -d
```

- Grafana: http://localhost:3300, дашборд «Planner — API» открывается сразу, без входа.
- Prometheus: http://localhost:9090
- API через прокси с метриками: http://localhost:8787/api/… (тот же API, только с подсчётом запросов)

Порты открыты только на 127.0.0.1, из сети их не видно.

## Что откуда берётся

| На дашборде | Источник |
|---|---|
| запросы в секунду, время ответа, ошибки, «ждут ответа» | `proxy/metrics_proxy.ts`: стоит перед API и считает то, что видит клиент |
| CPU и память контейнеров (edge runtime, Postgres, PostgREST, Kong) | `proxy/docker_stats.ts`: берёт данные из Docker API (cAdvisor на Docker Desktop с containerd контейнеры не распознаёт) |
| соединения Postgres | postgres-exporter |
| число пользователей k6 | k6 пишет его в Prometheus сам (remote write) |

Метрики считаются в прокси, а не внутри edge-функции. Функция работает в изолятах, которые рантайм поднимает и гасит сам, поэтому счётчики внутри неё сбрасывались бы и расходились между изолятами.

Чтобы на дашборде было видно и миниапп в dev, направь его на прокси: `VITE_API_URL=http://localhost:8787/api`.

## Нагрузочный тест

```sh
loadtest/run.sh                                  # 10 → 300 пользователей, ступени по 45 с, ~10 минут
STEPS=10,50,100 HOLD=30s loadtest/run.sh         # свои ступени
deno run --allow-net --allow-read --allow-env loadtest/report.ts   # таблица по ступеням
```

`run.sh` создаёт в локальной базе тестовых пользователей (tg_id 900000001…) с задачами, тратами и привычками. Ещё он подписывает для них initData локальным токеном из `loadtest/functions.env` (прод такую подпись не примет) и запускает k6 в Docker.

Каждый виртуальный пользователь повторяет один цикл: открывает миниапп (4 запроса разом), смотрит одну вкладку и в половине случаев создаёт задачу и отмечает её выполненной или записывает трату. Между действиями пауза 1–3 с.

## Остановить

```sh
docker compose -f monitoring/docker-compose.yml down      # -v — заодно стереть историю метрик
supabase stop
```
