import { assertEquals } from "jsr:@std/assert@1";
import { handleApi } from "./handler.ts";
import type { ApiDb, ApiUser, InboxInsert } from "./db.ts";
import { signInitData } from "./initdata.ts";
import { mintSession, SESSION_MAX } from "./session.ts";

const TOKEN = "123:ABC";
const NOW = 1_790_900_000;

class FakeApiDb implements ApiDb {
  user: ApiUser | null = { id: "u1", is_allowed: true, onboarded_at: "2026-10-01T00:00:00Z" };
  calls: Array<[string, unknown[]]> = [];
  inbox: InboxInsert[] = [];
  online: boolean | Error = true;
  uploads: Array<[string, number, string]> = [];
  removed: string[] = [];
  failInbox = false;
  async uploadAudio(path: string, bytes: Uint8Array, contentType: string) {
    this.uploads.push([path, bytes.length, contentType]);
  }
  async removeAudio(path: string) {
    this.removed.push(path);
  }
  async userByTg(_tg: number) { return this.user; }
  /**
   * Проверка лимита — не бизнес-вызов, и в ожиданиях тестов ей делать нечего.
   * Поэтому `call` разбирает её сам, а всё остальное уходит в `rpc`,
   * который тесты и подменяют.
   */
  rateChecks: Array<[string, number, string]> = [];
  rateAllows = true;
  /** Проверка Pro — тоже служебная, как и лимит: в calls не попадает. */
  pro = true;
  proChecks = 0;
  async call(fn: string, args: unknown[]): Promise<unknown> {
    if (fn === "is_pro") {
      this.proChecks++;
      return this.pro;
    }
    if (fn === "rate_limit") {
      this.rateChecks.push([args[1] as string, args[2] as number, args[3] as string]);
      return this.rateAllows;
    }
    return await this.rpc(fn, args);
  }
  async rpc(fn: string, args: unknown[]): Promise<unknown> {
    this.calls.push([fn, args]);
    return { fn };
  }
  async createInbox(row: InboxInsert) {
    if (this.failInbox) throw new Error("db down");
    this.inbox.push(row);
    return "new-id";
  }
  async workerOnline() {
    if (this.online instanceof Error) throw this.online;
    return this.online;
  }
}

async function req(path: string, opts: { init?: string; method?: string; body?: unknown; session?: string } = {}) {
  const init = opts.init ?? await signInitData({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 7 }) }, TOKEN);
  return new Request(`https://x.supabase.co/functions/v1/api${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(init ? { "x-init-data": init } : {}),
      ...(opts.session ? { "x-session": opts.session } : {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function run(r: Request, db = new FakeApiDb()) {
  const res = await handleApi(r, { db, botToken: TOKEN, nowSec: () => NOW, newId: () => "f-1" });
  const body = res.status === 204 ? null : await res.json();
  return {
    status: res.status, body, db, cors: res.headers.get("access-control-allow-origin"),
    session: res.headers.get("x-session"), expose: res.headers.get("access-control-expose-headers"),
  };
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
  db.rpc = () => Promise.reject(new Error("boom"));
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
  db.rpc = () => Promise.reject(Object.assign(new Error("relation boom"), { code: "42P01" }));
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
  const mk = () => { const db = new FakeApiDb(); db.rpc = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(true); }; return db; };
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
  db.rpc = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(false); };
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
  const mk = () => { const db = new FakeApiDb(); db.rpc = (fn, args) => { db.calls.push([fn, args]); return Promise.resolve(true); }; return db; };
  let r = await run(await req(`/transactions/${ID}`, { method: "POST", body: { amount: 200 } }), mk());
  assertEquals([r.status, r.body], [200, { ok: true }]);
  assertEquals(r.db.calls, [["update_transaction", ["u1", ID, 200, null, null]]]);
  r = await run(await req(`/transactions/${ID}`, { method: "POST", body: { title: "Латте", category: "кафе" } }), mk());
  assertEquals(r.db.calls, [["update_transaction", ["u1", ID, null, "Латте", "кафе"]]]);
  r = await run(await req(`/transactions/${ID}/delete`, { method: "POST", body: {} }), mk());
  assertEquals(r.db.calls, [["delete_transaction", ["u1", ID]]]);
  r = await run(await req(`/categories`));
  assertEquals(r.db.calls, [["api_categories", ["u1"]]]);
  r = await run(await req(`/categories/${ID}/color`, { method: "POST", body: { color: "green" } }), mk());
  assertEquals(r.db.calls, [["set_category_color", ["u1", ID, "green"]]]);
  r = await run(await req(`/categories/${ID}/color`, { method: "POST", body: { color: null } }), mk());
  assertEquals(r.db.calls, [["set_category_color", ["u1", ID, null]]]);
  for (const body of [{}, { color: "#ff0000" }, { color: 3 }]) {
    assertEquals((await run(await req(`/categories/${ID}/color`, { method: "POST", body }), mk())).status, 400,
      JSON.stringify(body));
  }
});

Deno.test("transactions: bad bodies are 400, missing row 404, db validation error 400", async () => {
  for (const body of [{}, { amount: 0 }, { amount: -5 }, { amount: "200" }, { amount: 1e14 }, { title: "  " },
    { title: "x".repeat(201) }, { category: 5 }, { category: "" }, null]) {
    assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body }))).status, 400, JSON.stringify(body));
  }
  const missing = new FakeApiDb();
  missing.rpc = () => Promise.resolve(false);
  assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body: { amount: 1 } }), missing)).status, 404);
  assertEquals((await run(await req(`/transactions/${ID}/delete`, { method: "POST", body: {} }), missing)).status, 404);
  const bad = new FakeApiDb();
  bad.rpc = () => Promise.reject({ code: "P0001", message: "bad category" });
  assertEquals((await run(await req(`/transactions/${ID}`, { method: "POST", body: { category: "нет такой" } }), bad)).status, 400);
});

class TrueDb extends FakeApiDb {
  override async rpc(fn: string, args: unknown[]): Promise<unknown> {
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
    override async rpc(fn: string, args: unknown[]) { this.calls.push([fn, args]); return null; }
  }
  assertEquals((await run(await req(`/inbox/${id}`), new NullDb())).status, 404);
  assertEquals((await run(await req("/inbox/not-a-uuid"))).status, 404);
});

async function audioReq(bytes: Uint8Array<ArrayBuffer>, contentType: string) {
  const init = await signInitData({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 7 }) }, TOKEN);
  return new Request("https://x.supabase.co/functions/v1/api/inbox/audio", {
    method: "POST", headers: { "x-init-data": init, "content-type": contentType }, body: bytes,
  });
}

Deno.test("POST /inbox/audio uploads and creates a row", async () => {
  const r = await run(await audioReq(new Uint8Array(1000), "audio/mp4"));
  assertEquals([r.status, r.body], [201, { id: "new-id", worker_online: true }]);
  assertEquals(r.db.uploads, [["u1/f-1.m4a", 1000, "audio/mp4"]]);
  assertEquals(r.db.inbox, [{ user_id: "u1", source: "miniapp", text: null, audio_ref: "storage:u1/f-1.m4a", reply_chat_id: 7 }]);
});

Deno.test("audio mime with params is accepted, others are 415", async () => {
  const r = await run(await audioReq(new Uint8Array(10), "audio/webm;codecs=opus"));
  assertEquals([r.status, r.db.uploads], [201, [["u1/f-1.webm", 10, "audio/webm"]]]);
  assertEquals((await run(await audioReq(new Uint8Array(10), "text/plain"))).status, 415);
});

Deno.test("audio size limits", async () => {
  assertEquals((await run(await audioReq(new Uint8Array(0), "audio/mp4"))).status, 400);
  const big = await run(await audioReq(new Uint8Array(2_097_153), "audio/mp4"));
  assertEquals([big.status, big.db.uploads.length], [413, 0]);
});

Deno.test("audio is removed when the inbox insert fails", async () => {
  const db = new FakeApiDb();
  db.failInbox = true;
  const r = await run(await audioReq(new Uint8Array(10), "audio/mp4"), db);
  assertEquals([r.status, r.db.removed], [500, ["u1/f-1.m4a"]]);
});

// ——— План 7: создание записей руками и настройки из миниаппа ———

Deno.test("GET /profile and /settings map to rpc, months validated", async () => {
  assertEquals((await run(await req("/profile"))).db.calls, [["api_profile", ["u1", 6]]]);
  assertEquals((await run(await req("/profile?months=12"))).db.calls, [["api_profile", ["u1", 12]]]);
  assertEquals((await run(await req("/profile?months=0"))).status, 400);
  assertEquals((await run(await req("/profile?months=13"))).status, 400);
  assertEquals((await run(await req("/settings"))).db.calls, [["api_settings", ["u1"]]]);
});

Deno.test("POST /tasks creates and answers 201 with the new id", async () => {
  const db = new FakeApiDb();
  db.rpc = async (fn: string, args: unknown[]) => {
    db.calls.push([fn, args]);
    return "new-task-id";
  };
  const r = await run(await req("/tasks", { method: "POST", body: { title: "Позвонить врачу" } }), db);
  assertEquals([r.status, r.body], [201, { id: "new-task-id" }]);
  assertEquals(r.db.calls, [["create_task", ["u1", "Позвонить врачу", null, null]]]);
});

Deno.test("POST /tasks trims, keeps due date and time, rejects time without a date", async () => {
  const mk = async (body: unknown) => {
    const db = new FakeApiDb();
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return "id";
    };
    return await run(await req("/tasks", { method: "POST", body }), db);
  };
  assertEquals((await mk({ title: "  Хлеб  ", due_date: "2026-10-09", due_time: "09:30" })).db.calls,
    [["create_task", ["u1", "Хлеб", "2026-10-09", "09:30"]]]);
  assertEquals((await mk({ title: "x", due_time: "09:30" })).status, 400);
  assertEquals((await mk({ title: "   " })).status, 400);
  assertEquals((await mk({ title: "x", due_date: "2026-02-30" })).status, 400);
});

Deno.test("повтор: задача и встреча с repeat создают правило, на Free — 402, без даты — 400", async () => {
  const mk = async (path: string, body: unknown, pro = true) => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return "first-id";
    };
    return await run(await req(path, { method: "POST", body }), db);
  };
  const task = await mk("/tasks", { title: "Зарядка", due_date: "2026-10-19", repeat: { freq: "weekdays" } });
  assertEquals([task.status, task.body], [201, { id: "first-id" }]);
  assertEquals(task.db.calls, [["create_recurrence", ["u1", "task", "Зарядка", "2026-10-19", null, null, "weekdays"]]]);

  const ev = await mk("/events", { title: "Созвон", date: "2026-10-15", time: "10:00", with_whom: "Андрей", repeat: { freq: "weekly" } });
  assertEquals(ev.db.calls, [["create_recurrence", ["u1", "event", "Созвон", "2026-10-15", "10:00", "Андрей", "weekly"]]]);

  const free = await mk("/tasks", { title: "Зарядка", due_date: "2026-10-19", repeat: { freq: "daily" } }, false);
  assertEquals([free.status, free.body, free.db.calls], [402, { error: "pro_required" }, []]);
  assertEquals((await mk("/tasks", { title: "Зарядка", repeat: { freq: "daily" } })).status, 400);
  assertEquals((await mk("/tasks", { title: "Зарядка", due_date: "2026-10-19", repeat: { freq: "hourly" } })).status, 400);
  // без repeat — обычная задача, Pro не спрашиваем
  const plain = await mk("/tasks", { title: "Хлеб", repeat: null }, false);
  assertEquals([plain.status, plain.db.calls[0][0], plain.db.proChecks], [201, "create_task", 0]);
});

Deno.test("POST /recurrences/:id/stop останавливает повтор и на Free", async () => {
  const db = new FakeApiDb();
  db.pro = false;
  db.rpc = async (fn: string, args: unknown[]) => {
    db.calls.push([fn, args]);
    return true;
  };
  const id = "11111111-2222-3333-4444-555555555555";
  const r = await run(await req(`/recurrences/${id}/stop`, { method: "POST", body: {} }), db);
  assertEquals([r.status, r.db.calls], [200, [["stop_recurrence", ["u1", id]]]]);
});

Deno.test("регулярные платежи и прогноз: полные данные в Pro, на Free — только «закрыто»", async () => {
  const mk = (pro: boolean) => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return fn === "api_regular_payments" ? { base_currency: "RUB", monthly_total: 299, items: [{ id: "r1" }, { id: "r2" }] }
        : { forecast: 90000 };
    };
    return db;
  };
  assertEquals((await run(await req("/regular"), mk(true))).body.monthly_total, 299);
  assertEquals((await run(await req("/regular"), mk(false))).body, { locked: true, found: 2 });
  assertEquals((await run(await req("/forecast"), mk(true))).body, { forecast: 90000 });
  const free = await run(await req("/forecast"), mk(false));
  assertEquals([free.body, free.db.calls], [{ locked: true }, []]);
});

Deno.test("регулярный платёж: добавить и подтвердить — Pro, «не регулярный» — всем", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const mk = async (path: string, body: unknown, pro: boolean) => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return fn === "add_regular_payment" ? "new-id" : true;
    };
    return await run(await req(path, { method: "POST", body }), db);
  };
  const add = await mk("/regular", { title: " Аренда ", amount: 50000, day: 1, category: "дом" }, true);
  assertEquals([add.status, add.db.calls], [201, [["add_regular_payment", ["u1", "Аренда", 50000, 1, "дом"]]]]);
  assertEquals((await mk("/regular", { title: "Аренда", amount: 50000, day: 1 }, false)).status, 402);
  assertEquals((await mk("/regular", { title: "Аренда", amount: 50000, day: 32 }, true)).status, 400);
  assertEquals((await mk(`/regular/${id}/confirm`, {}, false)).status, 402);
  const ok = await mk(`/regular/${id}/confirm`, {}, true);
  assertEquals(ok.db.calls, [["set_regular_payment", ["u1", id, "active"]]]);
  const no = await mk(`/regular/${id}/dismiss`, {}, false);
  assertEquals([no.status, no.db.calls], [200, [["set_regular_payment", ["u1", id, "dismissed"]]]]);
});

Deno.test("календарь: ссылка только в Pro, сброс выдаёт новую", async () => {
  const mk = (pro: boolean, base: string | undefined = "https://p.supabase.co/functions/v1/calendar/") => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return { token: fn === "reset_calendar_token" ? "new" : "tok" };
    };
    return { db, base };
  };
  const call = async (path: string, pro: boolean, method = "GET", base?: string | null) => {
    const { db, base: b } = mk(pro, base === null ? undefined : base ?? undefined);
    const res = await handleApi(await req(path, method === "POST" ? { method, body: {} } : {}),
      { db, botToken: TOKEN, nowSec: () => NOW, calendarBase: base === null ? undefined : b });
    return { status: res.status, body: await res.json() };
  };
  assertEquals((await call("/calendar", true)).body, { url: "https://p.supabase.co/functions/v1/calendar/tok.ics" });
  assertEquals((await call("/calendar", false)).body, { locked: true });
  assertEquals((await call("/calendar/reset", true, "POST")).body, { url: "https://p.supabase.co/functions/v1/calendar/new.ics" });
  assertEquals((await call("/calendar/reset", false, "POST")).status, 402);
  assertEquals((await call("/calendar", true, "GET", null)).status, 503);
});

Deno.test("привычки: заморозка и статистика — Pro, разморозка — всем", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const mk = async (path: string, pro: boolean, body?: unknown, answer: unknown = "ok") => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return fn === "api_habit_stats" ? { best_streak: 12 } : answer;
    };
    return await run(await req(path, body === undefined ? {} : { method: "POST", body }), db);
  };
  const ok = await mk(`/habits/${id}/freeze`, true, { date: "2026-10-14" });
  assertEquals([ok.status, ok.db.calls], [200, [["freeze_habit_day", ["u1", id, "2026-10-14"]]]]);
  assertEquals((await mk(`/habits/${id}/freeze`, true, { date: "2026-10-14" }, "limit")).body, { error: "limit" });
  assertEquals((await mk(`/habits/${id}/freeze`, false, { date: "2026-10-14" })).status, 402);
  assertEquals((await mk(`/habits/${id}/freeze`, true, {})).status, 400);
  const un = await mk(`/habits/${id}/unfreeze`, false, { date: "2026-10-14" }, true);
  assertEquals([un.status, un.db.calls], [200, [["unfreeze_habit_day", ["u1", id, "2026-10-14"]]]]);
  assertEquals((await mk(`/habits/${id}/stats`, true)).body, { best_streak: 12 });
  assertEquals((await mk(`/habits/${id}/stats`, false)).body, { locked: true });
});

Deno.test("оформление: тема и акцент — Pro, сброс к умолчанию — всем", async () => {
  const mk = async (body: unknown, pro: boolean) => {
    const db = new FakeApiDb();
    db.pro = pro;
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return true;
    };
    return await run(await req("/settings/appearance", { method: "POST", body }), db);
  };
  const ok = await mk({ theme: "dark", accent: "ocean" }, true);
  assertEquals([ok.status, ok.db.calls], [200, [["set_appearance", ["u1", "dark", "ocean"]]]]);
  assertEquals((await mk({ theme: "dark", accent: "ocean" }, false)).status, 402);
  assertEquals((await mk({ theme: "auto", accent: "amber" }, false)).status, 200);
  assertEquals((await mk({ theme: "neon", accent: "amber" }, true)).status, 400);
});

Deno.test("POST /events requires a real date and time", async () => {
  const mk = async (body: unknown) => {
    const db = new FakeApiDb();
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return "id";
    };
    return await run(await req("/events", { method: "POST", body }), db);
  };
  assertEquals((await mk({ title: "Созвон", date: "2026-10-09", time: "14:00", with_whom: "Андрей" })).db.calls,
    [["create_event", ["u1", "Созвон", "2026-10-09", "14:00", "Андрей"]]]);
  assertEquals((await mk({ title: "Созвон", date: "2026-10-09" })).status, 400);
  assertEquals((await mk({ title: "Созвон", date: "2026-10-09", time: "25:00" })).status, 400);
});

Deno.test("POST /notes, /habits, /transactions validate their payloads", async () => {
  const mk = async (path: string, body: unknown) => {
    const db = new FakeApiDb();
    db.rpc = async (fn: string, args: unknown[]) => {
      db.calls.push([fn, args]);
      return "id";
    };
    return await run(await req(path, { method: "POST", body }), db);
  };
  assertEquals((await mk("/notes", { text: "идея", kind: "thought" })).db.calls,
    [["create_note", ["u1", "идея", "thought"]]]);
  assertEquals((await mk("/notes", { text: "идея", kind: "other" })).status, 400);
  assertEquals((await mk("/habits", { name: "Зарядка", target: 5 })).db.calls,
    [["create_habit", ["u1", "Зарядка", 5]]]);
  assertEquals((await mk("/habits", { name: "Зарядка", target: 8 })).status, 400);
  assertEquals((await mk("/transactions", { type: "expense", amount: 1500, title: "Такси", category: "Транспорт" })).db.calls,
    [["create_transaction", ["u1", "expense", 1500, "Такси", "Транспорт", null]]]);
  assertEquals((await mk("/transactions", { type: "expense", amount: 0 })).status, 400);
  assertEquals((await mk("/transactions", { type: "transfer", amount: 10 })).status, 400);
});

Deno.test("habit day, unarchive, limit and notify post routes", async () => {
  const H = "3f2c1a2b-1111-2222-3333-444455556666";
  assertEquals((await run(await req(`/habits/${H}/day`, { method: "POST", body: { date: "2026-10-06", done: true } }))).db.calls,
    [["set_habit_on", ["u1", H, "2026-10-06", true]]]);
  assertEquals((await run(await req(`/habits/${H}/day`, { method: "POST", body: { done: true } }))).status, 400);
  assertEquals((await run(await req(`/habits/${H}/unarchive`, { method: "POST", body: {} }))).db.calls,
    [["unarchive_habit", ["u1", H]]]);
  assertEquals((await run(await req("/settings/limit", { method: "POST", body: { amount: 90000 } }))).db.calls,
    [["api_set_limit", ["u1", 90000]]]);
  assertEquals((await run(await req("/settings/limit", { method: "POST", body: { amount: -1 } }))).status, 400);
  assertEquals((await run(await req("/settings/notify", { method: "POST", body: { kind: "daily", on: false } }))).db.calls,
    [["api_set_notify", ["u1", "daily", false]]]);
  assertEquals((await run(await req("/settings/notify", { method: "POST", body: { kind: "nope", on: false } }))).status, 400);
});

// ——— План 8: окно жизни initData и CORS ———

Deno.test("мутации требуют более свежей сессии, чем чтение", async () => {
  const old = async (ageSec: number) =>
    await signInitData({ auth_date: String(NOW - ageSec), user: JSON.stringify({ id: 7 }) }, TOKEN);

  // 12 часов: читать можно
  assertEquals((await run(await req("/today", { init: await old(12 * 3600) }))).status, 200);
  // ...а писать уже нет — и это «сессия устарела», а не «кто ты такой»
  const stale = await run(await req("/tasks", { method: "POST", body: { title: "x" }, init: await old(12 * 3600) }));
  assertEquals([stale.status, stale.body], [401, { error: "stale_session" }]);

  // 2 часа: обычная запись проходит (создание отвечает id, поэтому двойник отдаёт строку)
  const creating = new FakeApiDb();
  creating.rpc = () => Promise.resolve("new-id");
  assertEquals(
    (await run(await req("/tasks", { method: "POST", body: { title: "x" }, init: await old(2 * 3600) }), creating)).status,
    201,
  );
  // удаление записи мягкое и отменяемое — ему хватает обычного окна записи
  const id = "3f2c1a2b-1111-2222-3333-444455556666";
  const deleting = new FakeApiDb();
  deleting.rpc = () => Promise.resolve(true);
  assertEquals(
    (await run(await req(`/tasks/${id}/delete`, { method: "POST", body: {}, init: await old(2 * 3600) }), deleting)).status,
    200,
  );
  // ...а категория удаляется насовсем — ей нужна совсем свежая сессия
  const cat = await run(await req(`/categories/${id}/delete`, { method: "POST", body: {}, init: await old(2 * 3600) }));
  assertEquals([cat.status, cat.body], [401, { error: "stale_session" }]);
  assertEquals(
    (await run(await req(`/categories/${id}/delete`, { method: "POST", body: {}, init: await old(60) }), deleting)).status,
    200,
  );
});

Deno.test("просроченная совсем и подделанная подпись — разные ответы", async () => {
  const ancient = await signInitData({ auth_date: String(NOW - 40 * 86400), user: JSON.stringify({ id: 7 }) }, TOKEN);
  assertEquals((await run(await req("/today", { init: ancient }))).body, { error: "unauthorized" });
  assertEquals((await run(await req("/today", { init: "auth_date=1&hash=00" }))).body, { error: "unauthorized" });
});

Deno.test("CORS-заголовки есть на обычных ответах, не только на preflight", async () => {
  const r = await run(await req("/today"));
  assertEquals(r.cors, "*"); // MINIAPP_ORIGIN не задан — прежнее поведение
  assertEquals((await run(await req("/nope"))).cors, "*");
});

Deno.test("выгрузка всех данных тоже требует свежей сессии, хоть это и GET", async () => {
  const twoHours = await signInitData(
    { auth_date: String(NOW - 2 * 3600), user: JSON.stringify({ id: 7 }) },
    TOKEN,
  );
  const fresh = await signInitData({ auth_date: String(NOW - 60), user: JSON.stringify({ id: 7 }) }, TOKEN);
  assertEquals((await run(await req("/account/export", { init: twoHours }))).body, { error: "stale_session" });
  assertEquals((await run(await req("/account/export", { init: fresh }))).db.calls, [["export_data", ["u1"]]]);
  // обычное чтение двухчасовой давности по-прежнему работает
  assertEquals((await run(await req("/today", { init: twoHours }))).status, 200);
});

class ExportDb extends FakeApiDb {
  override async rpc(fn: string, args: unknown[]): Promise<unknown> {
    this.calls.push([fn, args]);
    if (fn === "api_categories") return { expense: [{ id: "c1", name: "еда", color: "green" }], income: [] };
    return {
      exported_at: "2026-10-01T00:00:00Z",
      profile: { name: "М", tz: "UTC", base_currency: "UZS", tg_username: null, created_at: "2026-09-01T00:00:00Z" },
      categories: [{ id: "c1", name: "еда", type: "expense", is_default: true }],
      budgets: [], items: [], notes: [], habits: [],
      transactions: [{ type: "expense", amount_base: 100, base_currency: "UZS", amount_orig: 100, currency_orig: "UZS",
        category: "еда", comment: null, occurred_at: "2026-09-30T10:00:00Z" }],
    };
  }
}

class FakeFiles {
  sent: Array<{ chatId: number; name: string; mime: string; size: number; caption?: string }> = [];
  fail = false;
  async sendDocument(chatId: number, doc: { name: string; bytes: Uint8Array; mime: string }, caption?: string) {
    if (this.fail) throw new Error("telegram sendDocument: Forbidden: bot was blocked by the user");
    this.sent.push({ chatId, name: doc.name, mime: doc.mime, size: doc.bytes.length, caption });
  }
}

async function sendExport(body: unknown, opts: { files?: FakeFiles | null; init?: string; db?: FakeApiDb } = {}) {
  const db = opts.db ?? new ExportDb();
  const files = opts.files === undefined ? new FakeFiles() : opts.files ?? undefined;
  const res = await handleApi(await req("/account/export/send", { method: "POST", body, init: opts.init }),
    { db, botToken: TOKEN, nowSec: () => NOW, files });
  return { status: res.status, body: await res.json(), db, files };
}

Deno.test("выгрузка в Excel уходит файлом в чат с ботом", async () => {
  const r = await sendExport({ format: "xlsx" });
  assertEquals([r.status, r.body], [200, { ok: true, name: "planner-2026-10-02.xlsx" }]);
  assertEquals(r.db.calls, [["export_data", ["u1"]], ["api_categories", ["u1"]]]);
  assertEquals(r.files!.sent.length, 1);
  assertEquals(r.files!.sent[0].chatId, 7);
  assertEquals(r.files!.sent[0].mime, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assertEquals(r.db.rateChecks.map((c) => c[0]), ["write", "export"]);
});

Deno.test("Excel с графиками — Pro, а JSON со всеми данными доступен и на Free", async () => {
  const free = () => {
    const db = new ExportDb();
    db.pro = false;
    return db;
  };
  const xlsx = await sendExport({ format: "xlsx" }, { db: free() });
  assertEquals([xlsx.status, xlsx.body], [402, { error: "pro_required" }]);
  assertEquals(xlsx.files!.sent, []);
  const asJson = await sendExport({ format: "json" }, { db: free() });
  assertEquals(asJson.status, 200);
  assertEquals(asJson.db.proChecks, 0);
});

Deno.test("выгрузка в JSON — тоже в чат, с цветами категорий", async () => {
  const r = await sendExport({ format: "json" });
  assertEquals(r.body.name, "planner-2026-10-02.json");
  assertEquals(r.files!.sent[0].mime, "application/json");
});

Deno.test("выгрузка файлом: формат, свежая сессия, лимит и заблокированный бот", async () => {
  assertEquals((await sendExport({ format: "pdf" })).status, 400);
  assertEquals((await sendExport({})).status, 400);
  const stale = await signInitData({ auth_date: String(NOW - 2 * 3600), user: JSON.stringify({ id: 7 }) }, TOKEN);
  const old = await sendExport({ format: "xlsx" }, { init: stale });
  assertEquals([old.status, old.body, old.files!.sent.length], [401, { error: "stale_session" }, 0]);
  const limited = new ExportDb();
  limited.rateAllows = false;
  assertEquals((await sendExport({ format: "xlsx" }, { db: limited })).status, 429);
  assertEquals((await sendExport({ format: "xlsx" }, { files: null })).status, 503);
  const blocked = new FakeFiles();
  blocked.fail = true;
  const b = await sendExport({ format: "xlsx" }, { files: blocked });
  assertEquals([b.status, b.body], [502, { error: "send_failed" }]);
});

Deno.test("лимит запросов: инбокс, голос и запись считаются раздельно", async () => {
  const db = new FakeApiDb();
  await run(await req("/inbox", { method: "POST", body: { text: "привет" } }), db);
  await run(await req("/tasks", { method: "POST", body: { title: "x" } }), db);
  assertEquals(db.rateChecks.map((c) => c[0]), ["inbox", "write"]);
  // окна и пороги заданы явно, а не «на глаз»
  assertEquals(db.rateChecks[0][2], "10 minutes");

  const audio = new FakeApiDb();
  await run(new Request("https://x.supabase.co/functions/v1/api/inbox/audio", {
    method: "POST",
    headers: {
      "x-init-data": await signInitData({ auth_date: String(NOW - 10), user: JSON.stringify({ id: 7 }) }, TOKEN),
      "content-type": "audio/mp4",
    },
    body: new Uint8Array([1, 2, 3]),
  }), audio);
  assertEquals(audio.rateChecks.map((c) => c[0]), ["audio"]);
});

Deno.test("исчерпанный лимит — 429, и запись в инбокс не создаётся", async () => {
  const db = new FakeApiDb();
  db.rateAllows = false;
  const r = await run(await req("/inbox", { method: "POST", body: { text: "привет" } }), db);
  assertEquals([r.status, r.body], [429, { error: "too_many" }]);
  assertEquals(db.inbox.length, 0);

  const w = new FakeApiDb();
  w.rateAllows = false;
  assertEquals((await run(await req("/tasks", { method: "POST", body: { title: "x" } }), w)).status, 429);
  assertEquals(w.calls, []);
});

Deno.test("чтение лимитом не ограничено — сводку можно открывать сколько угодно", async () => {
  const db = new FakeApiDb();
  db.rateAllows = false;
  assertEquals((await run(await req("/today"), db)).status, 200);
  assertEquals(db.rateChecks, []);
});

Deno.test("сбой самой проверки лимита не ломает приложение", async () => {
  const db = new FakeApiDb();
  db.rpc = (fn: string, args: unknown[]) => {
    if (fn === "rate_limit") return Promise.reject(new Error("нет связи"));
    db.calls.push([fn, args]);
    return Promise.resolve({ fn });
  };
  assertEquals((await run(await req("/inbox", { method: "POST", body: { text: "привет" } }), db)).status, 201);
});

// ——— Подписка Pro ———

class FakePay {
  invoices: Array<{ payload: string; stars: number; subscriptionPeriod?: number }> = [];
  async createInvoiceLink(inv: { payload: string; stars: number; subscriptionPeriod?: number }) {
    this.invoices.push(inv);
    return "https://t.me/$abc";
  }
  async answerPreCheckoutQuery() {}
}

Deno.test("GET /subscription returns the status with the plans and their Stars prices", async () => {
  const db = new FakeApiDb();
  db.rpc = (fn: string, args: unknown[]) => {
    db.calls.push([fn, args]);
    return Promise.resolve({ status: "free", pro_until: null, ai_left: 3, ai_per_day: 3 });
  };
  const r = await run(await req("/subscription"), db);
  assertEquals(r.db.calls, [["api_subscription", ["u1"]]]);
  assertEquals(r.body.status, "free");
  assertEquals(r.body.plans.map((p: { id: string }) => p.id), ["month", "year", "lifetime"]);
  assertEquals(r.body.plans[0].recurring, true);
  assertEquals(r.body.plans[2].recurring, false);
  assertEquals(r.body.plans.map((p: { note: string | null }) => p.note),
    [null, "4 месяца в подарок", "осталось 100 из 100 мест"]);
});

Deno.test("Founder disappears from /subscription and its invoice is refused once 100 seats are sold", async () => {
  const soldOut = () => {
    const db = new FakeApiDb();
    db.rpc = () => Promise.resolve({ status: "free", pro_until: null, ai_left: 3, ai_per_day: 3, founder_sold: 100 });
    return db;
  };
  const r = await run(await req("/subscription"), soldOut());
  assertEquals(r.body.plans.map((p: { id: string }) => p.id), ["month", "year"]);

  const pay = new FakePay();
  const res = await handleApi(await req("/subscription/invoice", { method: "POST", body: { plan: "lifetime" } }),
    { db: soldOut(), botToken: TOKEN, nowSec: () => NOW, pay });
  assertEquals([res.status, await res.json()], [409, { error: "sold_out" }]);
  assertEquals(pay.invoices, []);
});

Deno.test("POST /subscription/invoice creates a Stars invoice link for the plan", async () => {
  const pay = new FakePay();
  const res = await handleApi(await req("/subscription/invoice", { method: "POST", body: { plan: "month" } }),
    { db: new FakeApiDb(), botToken: TOKEN, nowSec: () => NOW, pay });
  assertEquals([res.status, await res.json()], [200, { url: "https://t.me/$abc" }]);
  assertEquals(pay.invoices[0].payload, "pro:month");
  assertEquals(pay.invoices[0].subscriptionPeriod, 2592000);

  const bad = await handleApi(await req("/subscription/invoice", { method: "POST", body: { plan: "forever" } }),
    { db: new FakeApiDb(), botToken: TOKEN, nowSec: () => NOW, pay });
  assertEquals(bad.status, 400);
  const off = await run(await req("/subscription/invoice", { method: "POST", body: { plan: "month" } }));
  assertEquals(off.status, 503);
});

// ——— Токен сессии: свёрнутый миниапп живёт со старой initData ———

const initAged = async (ageSec: number, id = 7) =>
  await signInitData({ auth_date: String(NOW - ageSec), user: JSON.stringify({ id }) }, TOKEN);
const creatingDb = () => {
  const db = new FakeApiDb();
  db.rpc = () => Promise.resolve("new-id");
  return db;
};

Deno.test("сессия: свежая initData получает токен, CORS его отдаёт странице", async () => {
  const r = await run(await req("/today", { init: await initAged(60) }));
  assertEquals(r.status, 200);
  assertEquals(r.session?.startsWith("v1.7."), true);
  assertEquals(r.expose, "x-session");
});

Deno.test("сессия: initData старше часа токен не выдаёт", async () => {
  const r = await run(await req("/today", { init: await initAged(2 * 3600) }));
  assertEquals([r.status, r.session], [200, null]);
});

Deno.test("сессия: с токеном двухдневная initData и читает, и пишет", async () => {
  const token = await mintSession({ tgId: 7, iat: NOW - 3600, orig: NOW - 3600 }, TOKEN);
  const init = await initAged(2 * 86400);
  assertEquals((await run(await req("/today", { init }))).body, { error: "unauthorized" });
  assertEquals((await run(await req("/today", { init, session: token }))).status, 200);
  const w = await run(await req("/tasks", { method: "POST", body: { title: "x" }, init, session: token }), creatingDb());
  assertEquals([w.status, w.session], [201, null]); // токену меньше суток — не продлеваем
});

Deno.test("сессия: токен старше суток продлевается с тем же исходным входом", async () => {
  const orig = NOW - 3 * 86400;
  const token = await mintSession({ tgId: 7, iat: NOW - 2 * 86400, orig }, TOKEN);
  const r = await run(await req("/today", { init: await initAged(3 * 86400), session: token }));
  assertEquals(r.status, 200);
  assertEquals(r.session?.split(".").slice(0, 4), ["v1", "7", String(NOW), String(orig)]);
});

Deno.test("сессия: токен чужого человека не принимается", async () => {
  const token = await mintSession({ tgId: 8, iat: NOW - 60, orig: NOW - 60 }, TOKEN);
  const r = await run(await req("/today", { init: await initAged(2 * 86400, 7), session: token }));
  assertEquals([r.status, r.body], [401, { error: "unauthorized" }]);
});

Deno.test("сессия: подделанная initData с валидным токеном — отказ", async () => {
  const token = await mintSession({ tgId: 7, iat: NOW - 60, orig: NOW - 60 }, TOKEN);
  const r = await run(await req("/today", { init: "auth_date=1&hash=00", session: token }));
  assertEquals(r.status, 401);
});

Deno.test("сессия: необратимым действиям токен не помогает", async () => {
  const token = await mintSession({ tgId: 7, iat: NOW - 60, orig: NOW - 60 }, TOKEN);
  const r = await run(await req("/account/export", { init: await initAged(2 * 3600), session: token }));
  assertEquals([r.status, r.body], [401, { error: "stale_session" }]);
});

Deno.test("сессия: месяц от входа — и продления больше не спасают", async () => {
  const token = await mintSession({ tgId: 7, iat: NOW - 3600, orig: NOW - SESSION_MAX - 1 }, TOKEN);
  const r = await run(await req("/today", { init: await initAged(SESSION_MAX + 1), session: token }));
  assertEquals(r.status, 401);
});

Deno.test("сессия: при ошибке токен не выдаётся", async () => {
  const db = new FakeApiDb();
  db.user = null;
  const r = await run(await req("/today", { init: await initAged(60) }), db);
  assertEquals([r.status, r.session], [403, null]);
});
