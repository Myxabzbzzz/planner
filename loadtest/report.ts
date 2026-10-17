/**
 * Таблица по ступеням последнего прогона: сколько пользователей → RPS, время ответа, ошибки, CPU.
 * Берёт данные из Prometheus за время прогона (loadtest/results/started_at … finished_at).
 *
 *   deno run --allow-net --allow-read --allow-env loadtest/report.ts
 */
const PROM = Deno.env.get("PROM") ?? "http://127.0.0.1:9090";
const dir = new URL("./results/", import.meta.url);
const start = Number(await Deno.readTextFile(new URL("started_at", dir)));
const end = Number(await Deno.readTextFile(new URL("finished_at", dir)));

const W = "[20s]";
const Q = {
  vus: "max(k6_vus)",
  rps: `sum(rate(planner_http_requests_total${W}))`,
  p50: `histogram_quantile(0.5, sum by (le) (rate(planner_http_request_duration_seconds_bucket${W})))`,
  p95: `histogram_quantile(0.95, sum by (le) (rate(planner_http_request_duration_seconds_bucket${W})))`,
  err: `100 * (sum(rate(planner_http_requests_total{status=~"5.."}${W})) or vector(0)) / sum(rate(planner_http_requests_total${W}))`,
  r429: `100 * (sum(rate(planner_http_requests_total{status="429"}${W})) or vector(0)) / sum(rate(planner_http_requests_total${W}))`,
  edge: `100 * sum(rate(container_cpu_usage_seconds_total{name="supabase_edge_runtime_planner"}${W}))`,
  db: `100 * sum(rate(container_cpu_usage_seconds_total{name="supabase_db_planner"}${W}))`,
  rest: `100 * sum(rate(container_cpu_usage_seconds_total{name="supabase_rest_planner"}${W}))`,
  edgeMem: `sum(container_memory_working_set_bytes{name="supabase_edge_runtime_planner"}) / 1e6`,
};

async function series(expr: string): Promise<Map<number, number>> {
  const u = new URL("/api/v1/query_range", PROM);
  u.search = new URLSearchParams({ query: expr, start: String(start), end: String(end), step: "5" }).toString();
  const j = await (await fetch(u)).json();
  const out = new Map<number, number>();
  for (const [t, v] of j.data?.result?.[0]?.values ?? []) out.set(Number(t), Number(v));
  return out;
}

const data = Object.fromEntries(await Promise.all(Object.entries(Q).map(async ([k, q]) => [k, await series(q)])));
const times = [...data.vus.keys()].sort((a, b) => a - b);

// точка относится к ступени, если число пользователей держится уже 20 с — окно rate() целиком на ней
const steps = new Map<number, number[]>();
for (const t of times) {
  const v = data.vus.get(t)!;
  const stable = [5, 10, 15, 20].every((d) => data.vus.get(t - d) === v);
  if (v > 0 && stable) steps.set(v, [...(steps.get(v) ?? []), t]);
}

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const at = (k: string, ts: number[]) => median(ts.map((t) => data[k].get(t) ?? NaN));
const f = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");

console.log("польз. | RPS   | p50, мс | p95, мс | 5xx, % | 429, % | CPU edge | CPU db | CPU rest | RAM edge, МБ");
console.log("-------|-------|---------|---------|--------|--------|----------|--------|----------|-------------");
for (const [v, ts] of [...steps].sort((a, b) => a[0] - b[0])) {
  console.log([
    String(v).padStart(6), f(at("rps", ts), 1).padStart(5), f(at("p50", ts) * 1000).padStart(7),
    f(at("p95", ts) * 1000).padStart(7), f(at("err", ts), 1).padStart(6), f(at("r429", ts), 1).padStart(6),
    `${f(at("edge", ts))}%`.padStart(8), `${f(at("db", ts))}%`.padStart(6), `${f(at("rest", ts))}%`.padStart(8),
    f(at("edgeMem", ts)).padStart(11),
  ].join(" | "));
}
