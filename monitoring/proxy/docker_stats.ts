/**
 * CPU и память контейнеров planner для Prometheus — напрямую из Docker API.
 *
 * cAdvisor на Docker Desktop с хранилищем образов containerd не узнаёт контейнеры
 * («failed to identify the read-write layer ID»), поэтому считаем сами. Имена метрик —
 * как у cAdvisor, чтобы дашборд не зависел от того, кто их отдаёт.
 */

const SOCKET = Deno.env.get("DOCKER_SOCKET") ?? "/var/run/docker.sock";
const PORT = Number(Deno.env.get("PORT") ?? "9417");
const NAME = new RegExp(Deno.env.get("NAME_FILTER") ?? "^(supabase_.*_planner|planner-monitoring-.*)$");

/** Один запрос к Docker API по unix-сокету. HTTP/1.0 — чтобы ответ пришёл целиком, без chunked. */
async function docker(path: string): Promise<unknown> {
  const conn = await Deno.connect({ transport: "unix", path: SOCKET });
  try {
    await conn.write(new TextEncoder().encode(`GET ${path} HTTP/1.0\r\nHost: docker\r\n\r\n`));
    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(64 * 1024);
    for (;;) {
      const n = await conn.read(buf);
      if (n === null) break;
      chunks.push(buf.slice(0, n));
    }
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    chunks.reduce((at, c) => (all.set(c, at), at + c.length), 0);
    const raw = new TextDecoder().decode(all);
    const [head, ...rest] = raw.split("\r\n\r\n");
    if (!/^HTTP\/1\.[01] 200/.test(head)) throw new Error(`docker ${path}: ${head.split("\r\n")[0]}`);
    return JSON.parse(rest.join("\r\n\r\n"));
  } finally {
    conn.close();
  }
}

type Stats = {
  cpu_stats?: { cpu_usage?: { total_usage?: number } };
  memory_stats?: { usage?: number; stats?: { inactive_file?: number } };
};

async function render(): Promise<string> {
  const list = await docker("/containers/json") as { Id: string; Names: string[] }[];
  const mine = list
    .map((c) => ({ id: c.Id, name: (c.Names[0] ?? "").replace(/^\//, "") }))
    .filter((c) => NAME.test(c.name));
  const rows = await Promise.all(mine.map(async (c) => {
    try {
      return { ...c, s: await docker(`/containers/${c.id}/stats?stream=false&one-shot=true`) as Stats };
    } catch {
      return null; // контейнер остановили между двумя запросами
    }
  }));
  const out = [
    "# HELP container_cpu_usage_seconds_total CPU time consumed by the container.",
    "# TYPE container_cpu_usage_seconds_total counter",
  ];
  const mem = [
    "# HELP container_memory_working_set_bytes Memory in use minus reclaimable page cache (as in docker stats).",
    "# TYPE container_memory_working_set_bytes gauge",
  ];
  for (const r of rows) {
    if (!r) continue;
    const cpu = (r.s.cpu_stats?.cpu_usage?.total_usage ?? 0) / 1e9;
    const used = (r.s.memory_stats?.usage ?? 0) - (r.s.memory_stats?.stats?.inactive_file ?? 0);
    out.push(`container_cpu_usage_seconds_total{name="${r.name}"} ${cpu}`);
    mem.push(`container_memory_working_set_bytes{name="${r.name}"} ${Math.max(used, 0)}`);
  }
  return [...out, ...mem].join("\n") + "\n";
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  if (new URL(req.url).pathname !== "/metrics") return new Response("not found", { status: 404 });
  try {
    return new Response(await render(), { headers: { "content-type": "text/plain; version=0.0.4" } });
  } catch (e) {
    console.error("docker stats failed:", (e as Error)?.message);
    return new Response("docker unavailable\n", { status: 503 });
  }
});
