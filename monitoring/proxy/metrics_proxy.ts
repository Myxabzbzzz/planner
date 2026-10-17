/**
 * Прокси перед API с метриками для Prometheus.
 *
 * Edge-функция живёт в изолятах, которые рантайм поднимает и гасит сам, — счётчики внутри неё
 * не переживут и минуты и разъедутся по изолятам. Поэтому считаем снаружи: клиент (k6 или
 * миниапп в dev) ходит сюда, прокси пересылает запрос в API и записывает, что увидел клиент.
 *
 *   GET /metrics      — метрики
 *   всё остальное     — в UPSTREAM как есть (…/api/me → UPSTREAM/me)
 */

const UPSTREAM = (Deno.env.get("UPSTREAM") ?? "http://supabase_kong_planner:8000/functions/v1/api").replace(/\/$/, "");
const PORT = Number(Deno.env.get("PORT") ?? "8787");

/** Границы корзин времени ответа, секунды: от быстрого чтения до таймаута. */
const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];

type Key = string; // route|method|status
const requests = new Map<Key, number>();
const durations = new Map<string, { buckets: number[]; sum: number; count: number }>(); // route|method
let inFlight = 0;

/** /tasks/<uuid>/done → /tasks/:id/done — иначе каждая запись станет отдельной серией. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const route = (path: string) => (path.replace(/^\/api(?=\/|$)/, "").replace(UUID, ":id") || "/").slice(0, 80);

function observe(r: string, method: string, status: number, sec: number) {
  const k = `${r}|${method}|${status}`;
  requests.set(k, (requests.get(k) ?? 0) + 1);
  const dk = `${r}|${method}`;
  const h = durations.get(dk) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
  BUCKETS.forEach((b, i) => {
    if (sec <= b) h.buckets[i]++;
  });
  h.sum += sec;
  h.count++;
  durations.set(dk, h);
}

const esc = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function render(): string {
  const out: string[] = [
    "# HELP planner_http_requests_total Requests to the API seen by the proxy.",
    "# TYPE planner_http_requests_total counter",
  ];
  for (const [k, v] of requests) {
    const [r, m, s] = k.split("|");
    out.push(`planner_http_requests_total{route="${esc(r)}",method="${m}",status="${s}"} ${v}`);
  }
  out.push(
    "# HELP planner_http_request_duration_seconds Time from request to the full response body.",
    "# TYPE planner_http_request_duration_seconds histogram",
  );
  for (const [k, h] of durations) {
    const [r, m] = k.split("|");
    const l = `route="${esc(r)}",method="${m}"`;
    BUCKETS.forEach((b, i) => out.push(`planner_http_request_duration_seconds_bucket{${l},le="${b}"} ${h.buckets[i]}`));
    out.push(`planner_http_request_duration_seconds_bucket{${l},le="+Inf"} ${h.count}`);
    out.push(`planner_http_request_duration_seconds_sum{${l}} ${h.sum}`);
    out.push(`planner_http_request_duration_seconds_count{${l}} ${h.count}`);
  }
  out.push(
    "# HELP planner_http_requests_in_flight Requests currently waiting for the API.",
    "# TYPE planner_http_requests_in_flight gauge",
    `planner_http_requests_in_flight ${inFlight}`,
  );
  return out.join("\n") + "\n";
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/metrics") {
    return new Response(render(), { headers: { "content-type": "text/plain; version=0.0.4" } });
  }
  const r = route(url.pathname);
  const started = performance.now();
  inFlight++;
  let status = 502;
  try {
    const headers = new Headers(req.headers);
    headers.delete("host");
    const res = await fetch(UPSTREAM + url.pathname.replace(/^\/api(?=\/|$)/, "") + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      signal: AbortSignal.timeout(30_000),
    });
    status = res.status;
    // тело читаем целиком, чтобы время включало и его, а не только заголовки
    const body = await res.arrayBuffer();
    return new Response(body, { status: res.status, headers: res.headers });
  } catch (e) {
    // таймаут или API не отвечает — для клиента это ошибка, и считать её надо как ошибку
    status = (e as Error)?.name === "TimeoutError" ? 504 : 502;
    return new Response(JSON.stringify({ error: "upstream", detail: (e as Error)?.name }), {
      status,
      headers: { "content-type": "application/json" },
    });
  } finally {
    inFlight--;
    observe(r, req.method, status, (performance.now() - started) / 1000);
  }
});

console.log(`metrics proxy :${PORT} → ${UPSTREAM}`);
