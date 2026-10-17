#!/usr/bin/env bash
# Нагрузочный тест локального API planner. Только локальный стек — по проду не запускать.
#
#   supabase start
#   supabase functions serve --env-file loadtest/functions.env   # в отдельном терминале
#   docker compose -f monitoring/docker-compose.yml up -d
#   loadtest/run.sh                       # STEPS=10,50,100 HOLD=30s loadtest/run.sh — свои ступени
#
# Пока идёт тест, смотри http://localhost:3300 — дашборд «Planner — API».
# После теста: deno run --allow-net loadtest/report.ts — таблица по ступеням.
set -euo pipefail
cd "$(dirname "$0")/.."

USERS="${USERS:-500}"
docker exec supabase_db_planner true 2>/dev/null || { echo "локальный Supabase не запущен: supabase start"; exit 1; }
curl -sf -o /dev/null http://127.0.0.1:8787/metrics || { echo "прокси метрик не отвечает: docker compose -f monitoring/docker-compose.yml up -d"; exit 1; }

echo "→ тестовые пользователи в локальной базе ($USERS)"
docker exec -i -e PGOPTIONS="-c loadtest.users=$USERS" supabase_db_planner psql -U postgres -q < loadtest/seed.sql >/dev/null
deno run --allow-read --allow-write --allow-env loadtest/make_users.ts "$USERS"

# лимит на запись — 300 за 10 минут на человека; прошлые прогоны не должны съедать его у этого
docker exec supabase_db_planner psql -U postgres -qc \
  "delete from public.rate_events where user_id in (select id from public.users where tg_id between 900000001 and 900999999)"

mkdir -p loadtest/results
date -u +%s > loadtest/results/started_at
echo "→ k6"
docker run --rm -i --network supabase_network_planner \
  -v "$PWD/loadtest:/scripts" -w /scripts \
  -e STEPS -e HOLD \
  -e K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
  -e K6_PROMETHEUS_RW_PUSH_INTERVAL=5s \
  grafana/k6:1.1.0 run -o experimental-prometheus-rw ramp.js || true  # провал порогов — тоже результат
date -u +%s > loadtest/results/finished_at
echo "→ отчёт: deno run --allow-net --allow-read --allow-env loadtest/report.ts"
