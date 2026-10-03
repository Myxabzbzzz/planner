import { assertEquals } from "jsr:@std/assert@1";
import { handleApi } from "./handler.ts";
import type { ApiDb, ApiUser } from "./db.ts";
import { signInitData } from "./initdata.ts";

const TOKEN = "123:ABC";
const NOW = 1_790_900_000;

class FakeApiDb implements ApiDb {
  user: ApiUser | null = { id: "u1", is_allowed: true, onboarded_at: "2026-10-01T00:00:00Z" };
  calls: Array<[string, unknown[]]> = [];
  async userByTg(_tg: number) { return this.user; }
  async call(fn: string, args: unknown[]) {
    this.calls.push([fn, args]);
    return { fn };
  }
}

async function req(path: string, opts: { init?: string; method?: string } = {}) {
  const init = opts.init ?? await signInitData({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 7 }) }, TOKEN);
  return new Request(`https://x.supabase.co/functions/v1/api${path}`, {
    method: opts.method ?? "GET",
    headers: init ? { "x-init-data": init } : {},
  });
}

async function run(r: Request, db = new FakeApiDb()) {
  const res = await handleApi(r, { db, botToken: TOKEN, nowSec: () => NOW });
  const body = res.status === 204 ? null : await res.json();
  return { status: res.status, body, db, cors: res.headers.get("access-control-allow-origin") };
}

Deno.test("OPTIONS preflight", async () => {
  const r = await run(await req("/today", { method: "OPTIONS", init: "" }));
  assertEquals([r.status, r.cors], [204, "*"]);
});

Deno.test("routes map to rpc with validated params", async () => {
  assertEquals((await run(await req("/today"))).db.calls, [["summary_today", ["u1"]]]);
  assertEquals((await run(await req("/me"))).db.calls, [["api_me", ["u1"]]]);
  assertEquals((await run(await req("/tasks?filter=upcoming"))).db.calls, [["api_tasks", ["u1", "upcoming"]]]);
  assertEquals((await run(await req("/events?from=2026-10-01&to=2026-10-07"))).db.calls,
    [["api_events", ["u1", "2026-10-01", "2026-10-07"]]]);
  assertEquals((await run(await req("/money?month=2026-10"))).db.calls, [["api_money", ["u1", "2026-10"]]]);
  assertEquals((await run(await req("/habits"))).db.calls, [["api_habits", ["u1", 4]]]);
  assertEquals((await run(await req("/notes?q=%D0%B8%D0%B4%D0%B5%D1%8F"))).db.calls, [["api_notes", ["u1", "идея", null]]]);
});

Deno.test("notes accepts an opaque cursor", async () => {
  const r = await run(await req("/notes?before=2026-10-01%2010%3A00%3A00%2B00~3f2c1a2b-1111-2222-3333-444455556666"));
  assertEquals(r.db.calls, [["api_notes", ["u1", null, "2026-10-01 10:00:00+00~3f2c1a2b-1111-2222-3333-444455556666"]]]);
});

Deno.test("bad params are 400", async () => {
  assertEquals((await run(await req("/tasks?filter=all"))).status, 400);
  assertEquals((await run(await req("/events?from=2026-10-01&to=2026-12-01"))).status, 400);
  assertEquals((await run(await req("/events?from=2026-10-07&to=2026-10-01"))).status, 400);
  assertEquals((await run(await req("/money?month=2026-13"))).status, 400);
  assertEquals((await run(await req("/habits?weeks=0"))).status, 400);
  assertEquals((await run(await req("/notes?before=yesterday"))).status, 400);
});

Deno.test("auth: 401 without or with bad initData, 403 when not allowed or not onboarded", async () => {
  assertEquals((await run(await req("/today", { init: "" }))).status, 401);
  assertEquals((await run(await req("/today", { init: "auth_date=1&hash=00" }))).status, 401);
  const db = new FakeApiDb();
  db.user = { id: "u1", is_allowed: true, onboarded_at: null };
  assertEquals((await run(await req("/today"), db)).status, 403);
  const db2 = new FakeApiDb();
  db2.user = null;
  assertEquals((await run(await req("/today"), db2)).body, { error: "forbidden" });
});

Deno.test("404 unknown route, 405 non-GET, 500 on db error", async () => {
  assertEquals((await run(await req("/nope"))).status, 404);
  assertEquals((await run(await req("/today", { method: "POST" }))).status, 405);
  const db = new FakeApiDb();
  db.call = () => Promise.reject(new Error("boom"));
  const r = await run(await req("/today"), db);
  assertEquals([r.status, r.body], [500, { error: "server" }]);
});

Deno.test("path parsing strips only the first /api segment", async () => {
  assertEquals((await run(await req("/today").then((r) => new Request(r.url.replace("/functions/v1/api", "/api"), r)))).db.calls,
    [["summary_today", ["u1"]]]);
  assertEquals((await run(await req("/x/api/today"))).status, 404);
});

Deno.test("impossible calendar dates are 400", async () => {
  assertEquals((await run(await req("/events?from=2026-02-31&to=2026-03-02"))).status, 400);
  assertEquals((await run(await req("/events?from=2026-03-01&to=2026-04-31"))).status, 400);
});

Deno.test("db error is 500 and its message is logged", async () => {
  const db = new FakeApiDb();
  db.call = () => Promise.reject(Object.assign(new Error("relation boom"), { code: "42P01" }));
  const orig = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    const r = await run(await req("/today"), db);
    assertEquals(r.status, 500);
  } finally {
    console.error = orig;
  }
  const text = logged.flat().join(" ");
  assertEquals(text.includes("relation boom"), true);
  assertEquals(text.includes("42P01"), true);
});
