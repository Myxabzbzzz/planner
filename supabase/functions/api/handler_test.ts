import { assertEquals } from "jsr:@std/assert@1";
import { handleApi } from "./handler.ts";
import type { ApiDb, ApiUser, InboxInsert } from "./db.ts";
import { signInitData } from "./initdata.ts";

const TOKEN = "123:ABC";
const NOW = 1_790_900_000;

class FakeApiDb implements ApiDb {
  user: ApiUser | null = { id: "u1", is_allowed: true, onboarded_at: "2026-10-01T00:00:00Z" };
  calls: Array<[string, unknown[]]> = [];
  inbox: InboxInsert[] = [];
  online: boolean | Error = true;
  async userByTg(_tg: number) { return this.user; }
  async call(fn: string, args: unknown[]): Promise<unknown> {
    this.calls.push([fn, args]);
    return { fn };
  }
  async createInbox(row: InboxInsert) {
    this.inbox.push(row);
    return "new-id";
  }
  async workerOnline() {
    if (this.online instanceof Error) throw this.online;
    return this.online;
  }
}

async function req(path: string, opts: { init?: string; method?: string; body?: unknown } = {}) {
  const init = opts.init ?? await signInitData({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 7 }) }, TOKEN);
  return new Request(`https://x.supabase.co/functions/v1/api${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(init ? { "x-init-data": init } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
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
  assertEquals((await run(await req("/today", { method: "PUT" }))).status, 405);
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

const ID = "20000000-0000-0000-0000-000000000001";

Deno.test("POST marks map to rpc and return ok", async () => {
  const mk = () => { const db = new FakeApiDb(); db.call = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(true); }; return db; };
  let r = await run(await req(`/tasks/${ID}/done`, { method: "POST", body: { done: true } }), mk());
  assertEquals([r.status, r.body], [200, { ok: true }]);
  assertEquals(r.db.calls, [["set_item_done", ["u1", ID, "task", true]]]);
  r = await run(await req(`/events/${ID}/done`, { method: "POST", body: { done: false } }), mk());
  assertEquals(r.db.calls, [["set_item_done", ["u1", ID, "event", false]]]);
  r = await run(await req(`/habits/${ID}/today`, { method: "POST", body: { done: true } }), mk());
  assertEquals(r.db.calls, [["set_habit_today", ["u1", ID, true]]]);
});

Deno.test("POST errors: not found, bad body, bad id, wrong method, unauthenticated", async () => {
  const db = new FakeApiDb();
  db.call = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(false); };
  assertEquals((await run(await req(`/tasks/${ID}/done`, { method: "POST", body: { done: true } }), db)).status, 404);
  assertEquals((await run(await req(`/tasks/${ID}/done`, { method: "POST", body: { done: "yes" } }))).status, 400);
  assertEquals((await run(await req(`/tasks/not-a-uuid/done`, { method: "POST", body: { done: true } }))).status, 404);
  assertEquals((await run(await req(`/today`, { method: "POST", body: {} }))).status, 404);
  assertEquals((await run(await req(`/today`, { method: "PUT" }))).status, 405);
  assertEquals((await run(await req(`/tasks/${ID}/done`, { method: "POST", body: { done: true }, init: "" }))).status, 401);
});

Deno.test("CORS allows POST", async () => {
  const res = await handleApi(new Request("https://x/functions/v1/api/today", { method: "OPTIONS" }),
    { db: new FakeApiDb(), botToken: TOKEN, nowSec: () => NOW });
  assertEquals(res.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
});

Deno.test("transactions: edit, delete and categories", async () => {
  const mk = () => { const db = new FakeApiDb(); db.call = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(true); }; return db; };
  let r = await run(await req(`/transactions/${ID}`, { method: "POST", body: { amount: 200 } }), mk());
  assertEquals([r.status, r.body], [200, { ok: true }]);
  assertEquals(r.db.calls, [["update_transaction", ["u1", ID, 200, null, null]]]);
  r = await run(await req(`/transactions/${ID}`, { method: "POST", body: { title: "Латте", category: "кафе" } }), mk());
  assertEquals(r.db.calls, [["update_transaction", ["u1", ID, null, "Латте", "кафе"]]]);
  r = await run(await req(`/transactions/${ID}/delete`, { method: "POST", body: {} }), mk());
  assertEquals(r.db.calls, [["delete_transaction", ["u1", ID]]]);
  r = await run(await req(`/categories`));
  assertEquals(r.db.calls, [["api_categories", ["u1"]]]);
});

Deno.test("transactions: bad bodies are 400, missing row 404, db validation error 400", async () => {
  for (const body of [{}, { amount: 0 }, { amount: -5 }, { amount: "200" }, { amount: 1e14 }, { title: "  " },
    { title: "x".repeat(201) }, { category: 5 }, { category: "" }, null]) {
    assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body }))).status, 400, JSON.stringify(body));
  }
  const missing = new FakeApiDb();
  missing.call = () => Promise.resolve(false);
  assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body: { amount: 1 } }), missing)).status, 404);
  assertEquals((await run(await req(`/transactions/${ID}/delete`, { method: "POST", body: {} }), missing)).status, 404);
  const bad = new FakeApiDb();
  bad.call = () => Promise.reject({ code: "P0001", message: "bad category" });
  assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body: { category: "нет такой" } }), bad)).status, 400);
});

class TrueDb extends FakeApiDb {
  override async call(fn: string, args: unknown[]): Promise<unknown> {
    this.calls.push([fn, args]);
    return true;
  }
}
const EID = "3f2c1a2b-1111-2222-3333-444455556666";
const post = (path: string, body: unknown) => req(path, { method: "POST", body });

Deno.test("edit routes map bodies to sql args", async () => {
  const cases: Array<[string, unknown, string, unknown[]]> = [
    [`/tasks/${EID}`, { title: " Купить " }, "update_task", ["u1", EID, "Купить", null, null, false]],
    [`/tasks/${EID}`, { due_date: "2026-10-10", due_time: "09:30" }, "update_task", ["u1", EID, null, "2026-10-10", "09:30", false]],
    [`/tasks/${EID}`, { due_date: null }, "update_task", ["u1", EID, null, null, null, true]],
    [`/events/${EID}`, { time: "16:30", with_whom: "" }, "update_event", ["u1", EID, null, null, "16:30", ""]],
    [`/notes/${EID}`, { text: "Идея", kind: "journal" }, "update_note", ["u1", EID, "Идея", "journal"]],
    [`/habits/${EID}`, { name: "Чтение", target: 3 }, "update_habit", ["u1", EID, "Чтение", 3]],
    [`/tasks/${EID}/delete`, {}, "delete_item", ["u1", EID, "task"]],
    [`/events/${EID}/delete`, {}, "delete_item", ["u1", EID, "event"]],
    [`/notes/${EID}/delete`, {}, "delete_note", ["u1", EID]],
    [`/habits/${EID}/archive`, {}, "archive_habit", ["u1", EID]],
  ];
  for (const [path, body, fn, args] of cases) {
    const r = await run(await post(path, body), new TrueDb());
    assertEquals([r.status, r.db.calls], [200, [[fn, args]]], path);
  }
});

Deno.test("edit routes reject bad bodies", async () => {
  const bad: Array<[string, unknown]> = [
    [`/tasks/${EID}`, {}],
    [`/tasks/${EID}`, { due_time: "09:30" }],
    [`/tasks/${EID}`, { due_date: "2026-02-30" }],
    [`/tasks/${EID}`, { title: "" }],
    [`/events/${EID}`, { time: "9:30" }],
    [`/events/${EID}`, { with_whom: "x".repeat(201) }],
    [`/notes/${EID}`, { kind: "idea" }],
    [`/notes/${EID}`, { text: "x".repeat(4001) }],
    [`/habits/${EID}`, { target: 0 }],
    [`/habits/${EID}`, { target: 2.5 }],
  ];
  for (const [path, body] of bad) {
    assertEquals((await run(await post(path, body), new TrueDb())).status, 400, JSON.stringify(body));
  }
});

Deno.test("edit of a missing item is 404", async () => {
  const r = await run(await post(`/notes/${EID}`, { text: "x" }));  // FakeApiDb.call → не true
  assertEquals(r.status, 404);
});

Deno.test("POST /inbox creates a miniapp row and reports worker state", async () => {
  const r = await run(await req("/inbox", { method: "POST", body: { text: "  кофе 40 000 " } }));
  assertEquals([r.status, r.body], [201, { id: "new-id", worker_online: true }]);
  assertEquals(r.db.inbox, [{ user_id: "u1", source: "miniapp", text: "кофе 40 000", audio_ref: null, reply_chat_id: 7 }]);
});

Deno.test("POST /inbox: worker check failure means offline, bad text is 400", async () => {
  const db = new FakeApiDb();
  db.online = new Error("down");
  assertEquals((await run(await req("/inbox", { method: "POST", body: { text: "x" } }), db)).body, { id: "new-id", worker_online: false });
  for (const body of [{ text: "  " }, { text: "x".repeat(4001) }, { text: 5 }, {}]) {
    const r = await run(await req("/inbox", { method: "POST", body }));
    assertEquals([r.status, r.db.inbox.length], [400, 0], JSON.stringify(body));
  }
});

Deno.test("GET /inbox/<id> returns own status, null is 404", async () => {
  const id = "3f2c1a2b-1111-2222-3333-444455556666";
  assertEquals((await run(await req(`/inbox/${id}`))).db.calls, [["api_inbox_status", ["u1", id]]]);
  class NullDb extends FakeApiDb {
    override async call(fn: string, args: unknown[]) { this.calls.push([fn, args]); return null; }
  }
  assertEquals((await run(await req(`/inbox/${id}`), new NullDb())).status, 404);
  assertEquals((await run(await req("/inbox/not-a-uuid"))).status, 404);
});
