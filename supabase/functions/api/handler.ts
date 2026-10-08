import type { ApiDb, InboxInsert } from "./db.ts";
import { LIMITS } from "../_shared/limits.ts";
import { MAX_AGE_READ, MAX_AGE_SENSITIVE, MAX_AGE_WRITE, verifyInitData } from "./initdata.ts";

export type ApiDeps = { db: ApiDb; botToken: string; nowSec: () => number; newId?: () => string };

/**
 * Origin миниаппа задаётся переменной MINIAPP_ORIGIN (через запятую, если их
 * несколько). Пока она не задана, остаётся прежнее «*» — чтобы деплой не сломался,
 * — но в docs/deploy.md это отмечено как то, что нужно выставить.
 */
const ALLOWED = (Deno.env.get("MINIAPP_ORIGIN") ?? "")
  .split(",").map((o: string) => o.trim()).filter((o: string) => o !== "");

function corsFor(req: Request): Record<string, string> {
  const base = {
    "access-control-allow-headers": "x-init-data, content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
  if (ALLOWED.length === 0) return { ...base, "access-control-allow-origin": "*" };
  const origin = req.headers.get("origin") ?? "";
  return ALLOWED.includes(origin)
    ? { ...base, "access-control-allow-origin": origin }
    : base; // чужой origin — заголовка нет, браузер не отдаст ответ странице
}

const json = (status: number, body: unknown, cors: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const CURSOR = /^[^~]{1,64}~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = ["today", "upcoming", "nodue", "done"];
const realDate = (d: string) => DATE.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;
const DAY_MS = 86_400_000;

class BadRequest extends Error {}

function route(path: string, q: URLSearchParams, userId: string): [string, unknown[]] | null {
  const inbox = new RegExp(`^/inbox/(${UUID})$`, "i").exec(path);
  if (inbox) return ["api_inbox_status", [userId, inbox[1].toLowerCase()]];
  switch (path) {
    case "/me":
      return ["api_me", [userId]];
    case "/today":
      return ["summary_today", [userId]];
    case "/tasks": {
      const f = q.get("filter") ?? "today";
      if (!FILTERS.includes(f)) throw new BadRequest();
      return ["api_tasks", [userId, f]];
    }
    case "/events": {
      const from = q.get("from") ?? "", to = q.get("to") ?? "";
      if (!realDate(from) || !realDate(to)) throw new BadRequest();
      const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
      if (!(span >= 0 && span <= 31)) throw new BadRequest();
      return ["api_events", [userId, from, to]];
    }
    case "/money": {
      const month = q.get("month") ?? "";
      if (!MONTH.test(month)) throw new BadRequest();
      return ["api_money", [userId, month]];
    }
    case "/habits": {
      const weeks = Number(q.get("weeks") ?? "4");
      if (!Number.isInteger(weeks) || weeks < 1 || weeks > 12) throw new BadRequest();
      return ["api_habits", [userId, weeks]];
    }
    case "/categories":
      return ["api_categories", [userId]];
    case "/settings":
      return ["api_settings", [userId]];
    case "/reviews":
      return ["api_reviews", [userId]];
    case "/account/export":
      return ["export_data", [userId]];
    case "/budgets": {
      const month = q.get("month") ?? "";
      if (!MONTH.test(month)) throw new BadRequest();
      return ["api_budgets", [userId, month]];
    }
    case "/operations": {
      const month = q.get("month") ?? "";
      if (!MONTH.test(month)) throw new BadRequest();
      const before = q.get("before");
      if (before && !CURSOR.test(before)) throw new BadRequest();
      return ["api_operations", [userId, month, before || null]];
    }
    case "/profile": {
      const months = Number(q.get("months") ?? "6");
      if (!Number.isInteger(months) || months < 1 || months > 12) throw new BadRequest();
      return ["api_profile", [userId, months]];
    }
    case "/notes": {
      const query = (q.get("q") ?? "").slice(0, 100);
      const before = q.get("before");
      if (before && !CURSOR.test(before)) throw new BadRequest();
      return ["api_notes", [userId, query || null, before || null]];
    }
  }
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
type BodyParser = (body: Record<string, unknown>, userId: string, id: string) => unknown[];

const doneArg = (b: Record<string, unknown>) => {
  if (typeof b.done !== "boolean") throw new BadRequest();
  return b.done;
};

function txPatch(b: Record<string, unknown>, userId: string, id: string): unknown[] {
  const { amount, title, category } = b;
  if (amount === undefined && title === undefined && category === undefined) throw new BadRequest();
  if (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < 1e13)) {
    throw new BadRequest();
  }
  if (title !== undefined && !(typeof title === "string" && title.trim() !== "" && title.trim().length <= 200)) {
    throw new BadRequest();
  }
  if (category !== undefined && !(typeof category === "string" && category !== "" && category.length <= 50)) {
    throw new BadRequest();
  }
  return [userId, id, amount ?? null, typeof title === "string" ? title.trim() : null, category ?? null];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isTitle = (v: unknown) => typeof v === "string" && v.trim() !== "" && v.trim().length <= 200;

function optTitle(v: unknown): string | null {
  if (v === undefined) return null;
  if (!isTitle(v)) throw new BadRequest();
  return (v as string).trim();
}

function requireSome(b: Record<string, unknown>, keys: string[]) {
  if (!keys.some((k) => b[k] !== undefined)) throw new BadRequest();
}

function taskPatch(b: Record<string, unknown>, u: string, id: string): unknown[] {
  requireSome(b, ["title", "due_date", "due_time"]);
  const { due_date, due_time } = b;
  if (due_date !== undefined && due_date !== null && !(typeof due_date === "string" && realDate(due_date))) throw new BadRequest();
  if (due_time !== undefined && due_time !== null && !(typeof due_time === "string" && TIME.test(due_time))) throw new BadRequest();
  if (typeof due_time === "string" && typeof due_date !== "string") throw new BadRequest();
  return [u, id, optTitle(b.title), due_date ?? null, due_time ?? null, due_date === null];
}

function eventPatch(b: Record<string, unknown>, u: string, id: string): unknown[] {
  requireSome(b, ["title", "date", "time", "with_whom"]);
  const { date, time, with_whom } = b;
  if (date !== undefined && !(typeof date === "string" && realDate(date))) throw new BadRequest();
  if (time !== undefined && !(typeof time === "string" && TIME.test(time))) throw new BadRequest();
  if (with_whom !== undefined && !(typeof with_whom === "string" && with_whom.trim().length <= 200)) throw new BadRequest();
  return [u, id, optTitle(b.title), date ?? null, time ?? null, with_whom ?? null];
}

function notePatch(b: Record<string, unknown>, u: string, id: string): unknown[] {
  requireSome(b, ["text", "kind"]);
  const { text, kind } = b;
  if (text !== undefined && !(typeof text === "string" && text.trim() !== "" && text.trim().length <= 4000)) throw new BadRequest();
  if (kind !== undefined && kind !== "thought" && kind !== "journal") throw new BadRequest();
  return [u, id, typeof text === "string" ? text.trim() : null, kind ?? null];
}

function habitPatch(b: Record<string, unknown>, u: string, id: string): unknown[] {
  requireSome(b, ["name", "target"]);
  const { target } = b;
  if (target !== undefined && !(Number.isInteger(target) && (target as number) >= 1 && (target as number) <= 7)) throw new BadRequest();
  return [u, id, optTitle(b.name), target ?? null];
}

// ——— создание записей руками, без ИИ-воркера ———
const reqTitle = (v: unknown): string => {
  if (!isTitle(v)) throw new BadRequest();
  return (v as string).trim();
};
const optDate = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !realDate(v)) throw new BadRequest();
  return v;
};
const optTime = (v: unknown): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !TIME.test(v)) throw new BadRequest();
  return v;
};

function newTask(b: Record<string, unknown>, u: string): unknown[] {
  const date = optDate(b.due_date), time = optTime(b.due_time);
  if (time !== null && date === null) throw new BadRequest();
  return [u, reqTitle(b.title), date, time];
}

function newEvent(b: Record<string, unknown>, u: string): unknown[] {
  const date = optDate(b.date), time = optTime(b.time);
  if (date === null || time === null) throw new BadRequest();
  if (b.with_whom !== undefined && !(typeof b.with_whom === "string" && b.with_whom.trim().length <= 200)) {
    throw new BadRequest();
  }
  return [u, reqTitle(b.title), date, time, b.with_whom ?? null];
}

function newNote(b: Record<string, unknown>, u: string): unknown[] {
  const { text, kind } = b;
  if (!(typeof text === "string" && text.trim() !== "" && text.trim().length <= 4000)) throw new BadRequest();
  if (kind !== "thought" && kind !== "journal") throw new BadRequest();
  return [u, text.trim(), kind];
}

function newHabit(b: Record<string, unknown>, u: string): unknown[] {
  const { target } = b;
  if (!(Number.isInteger(target) && (target as number) >= 1 && (target as number) <= 7)) throw new BadRequest();
  return [u, reqTitle(b.name), target];
}

function newTransaction(b: Record<string, unknown>, u: string): unknown[] {
  const { type, amount, title, category } = b;
  if (type !== "expense" && type !== "income") throw new BadRequest();
  if (!(typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < 1e13)) throw new BadRequest();
  if (title !== undefined && !(typeof title === "string" && title.trim().length <= 200)) throw new BadRequest();
  if (category !== undefined && !(typeof category === "string" && category.length <= 50)) throw new BadRequest();
  return [u, type, amount, typeof title === "string" ? title.trim() : null, category ?? null, optDate(b.date)];
}

const CREATE_ROUTES: Record<string, [string, (b: Record<string, unknown>, u: string) => unknown[]]> = {
  "/tasks": ["create_task", newTask],
  "/events": ["create_event", newEvent],
  "/notes": ["create_note", newNote],
  "/habits": ["create_habit", newHabit],
  "/transactions": ["create_transaction", newTransaction],
};

function habitDay(b: Record<string, unknown>, u: string, id: string): unknown[] {
  const date = optDate(b.date);
  if (date === null) throw new BadRequest();
  return [u, id, date, doneArg(b)];
}

function limitArg(b: Record<string, unknown>, u: string): unknown[] {
  const { amount } = b;
  if (!(typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount < 1e13)) throw new BadRequest();
  return [u, amount];
}

function notifyArg(b: Record<string, unknown>, u: string): unknown[] {
  const { kind, on } = b;
  if (kind !== "reminders" && kind !== "daily" && kind !== "weekly") throw new BadRequest();
  if (typeof on !== "boolean") throw new BadRequest();
  return [u, kind, on];
}

function opEdit(b: Record<string, unknown>, u: string, id: string): unknown[] {
  requireSome(b, ["amount", "title", "category", "date", "type", "currency"]);
  const { amount, title, category, date, type, currency } = b;
  if (amount !== undefined && !(typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount < 1e13)) {
    throw new BadRequest();
  }
  if (title !== undefined && !(typeof title === "string" && title.trim().length <= 200)) throw new BadRequest();
  if (category !== undefined && !(typeof category === "string" && category.length <= 50)) throw new BadRequest();
  if (type !== undefined && type !== "expense" && type !== "income") throw new BadRequest();
  if (currency !== undefined && !(typeof currency === "string" && /^[A-Z]{3}$/.test(currency))) throw new BadRequest();
  return [
    u, id, amount ?? null, typeof title === "string" ? title.trim() : null, category ?? null,
    optDate(date), type ?? null, currency ?? null,
  ];
}

function categoryLimit(b: Record<string, unknown>, u: string): unknown[] {
  const { category, amount } = b;
  if (!(typeof category === "string" && category.trim() !== "" && category.length <= 50)) throw new BadRequest();
  if (!(typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount < 1e13)) throw new BadRequest();
  return [u, category.trim(), amount];
}

/** Вопрос бывает двух видов: «что это» и «во сколько» — у них разные RPC. */
const REVIEW_KINDS = ["type", "time"] as const;

function reviewAnswer(b: Record<string, unknown>): { fn: string; idx: number; choice: string } {
  const { index, choice, kind } = b;
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 50) throw new BadRequest();
  if (!(typeof choice === "string" && choice.length > 0 && choice.length <= 32)) throw new BadRequest();
  if (kind !== undefined && !REVIEW_KINDS.includes(kind as typeof REVIEW_KINDS[number])) throw new BadRequest();
  return { fn: kind === "time" ? "resolve_time" : "resolve_review", idx: index as number, choice };
}

const POST_ROUTES: [RegExp, string, BodyParser][] = [
  [new RegExp(`^/tasks/(${UUID})/restore$`, "i"), "restore_item", (_b, u, id) => [u, id, "task"]],
  [new RegExp(`^/events/(${UUID})/restore$`, "i"), "restore_item", (_b, u, id) => [u, id, "event"]],
  [new RegExp(`^/notes/(${UUID})/restore$`, "i"), "restore_note", (_b, u, id) => [u, id]],
  [new RegExp(`^/transactions/(${UUID})/restore$`, "i"), "restore_transaction", (_b, u, id) => [u, id]],
  [new RegExp(`^/transactions/(${UUID})/edit$`, "i"), "edit_transaction", opEdit],
  [new RegExp(`^/categories/(${UUID})$`, "i"), "rename_category", (b, u, id) => {
    if (!isTitle(b.name) || (b.name as string).trim().length > 50) throw new BadRequest();
    return [u, id, (b.name as string).trim()];
  }],
  [new RegExp(`^/categories/(${UUID})/delete$`, "i"), "delete_category", (_b, u, id) => [u, id]],
  [/^\/settings\/category-limit$/, "set_category_limit", categoryLimit],
  [/^\/account\/delete$/, "delete_account", (_b, u) => [u]],
  [/^\/settings\/limit$/, "api_set_limit", limitArg],
  [/^\/settings\/notify$/, "api_set_notify", notifyArg],
  [new RegExp(`^/habits/(${UUID})/day$`, "i"), "set_habit_on", habitDay],
  [new RegExp(`^/habits/(${UUID})/unarchive$`, "i"), "unarchive_habit", (_b, u, id) => [u, id]],
  [new RegExp(`^/tasks/(${UUID})/done$`, "i"), "set_item_done", (b, u, id) => [u, id, "task", doneArg(b)]],
  [new RegExp(`^/events/(${UUID})/done$`, "i"), "set_item_done", (b, u, id) => [u, id, "event", doneArg(b)]],
  [new RegExp(`^/habits/(${UUID})/today$`, "i"), "set_habit_today", (b, u, id) => [u, id, doneArg(b)]],
  [new RegExp(`^/transactions/(${UUID})$`, "i"), "update_transaction", txPatch],
  [new RegExp(`^/transactions/(${UUID})/delete$`, "i"), "delete_transaction", (_b, u, id) => [u, id]],
  [new RegExp(`^/tasks/(${UUID})$`, "i"), "update_task", taskPatch],
  [new RegExp(`^/events/(${UUID})$`, "i"), "update_event", eventPatch],
  [new RegExp(`^/notes/(${UUID})$`, "i"), "update_note", notePatch],
  [new RegExp(`^/habits/(${UUID})$`, "i"), "update_habit", habitPatch],
  [new RegExp(`^/tasks/(${UUID})/delete$`, "i"), "delete_item", (_b, u, id) => [u, id, "task"]],
  [new RegExp(`^/events/(${UUID})/delete$`, "i"), "delete_item", (_b, u, id) => [u, id, "event"]],
  [new RegExp(`^/notes/(${UUID})/delete$`, "i"), "delete_note", (_b, u, id) => [u, id]],
  [new RegExp(`^/habits/(${UUID})/archive$`, "i"), "archive_habit", (_b, u, id) => [u, id]],
];

async function postRoute(path: string, req: Request, userId: string): Promise<[string, unknown[]] | null> {
  for (const [re, fn, parse] of POST_ROUTES) {
    const m = re.exec(path);
    if (!m) continue;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new BadRequest();
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new BadRequest();
    return [fn, parse(body as Record<string, unknown>, userId, (m[1] ?? "").toLowerCase())];
  }
  return null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequest();
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new BadRequest();
  return body as Record<string, unknown>;
}

/** Создание: в ответ уходит id новой записи, а не просто ok. */
async function createRoute(path: string, req: Request, userId: string): Promise<[string, unknown[]] | null> {
  const hit = CREATE_ROUTES[path];
  if (!hit) return null;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequest();
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new BadRequest();
  return [hit[0], hit[1](body as Record<string, unknown>, userId)];
}

const MAX_TEXT = 4000;

/**
 * Лимиты на то, что реально дорого: каждая запись в инбокс — это строка в очереди
 * воркера, а голосовая ещё и до 2 МБ в Storage. Утёкшая initData жила сутки и
 * ничем не ограничивалась — можно было забить и очередь, и хранилище.
 * Пороги щедрые для человека и тесные для скрипта.
 */

/** false — лимит исчерпан. Сбой самой проверки не должен ломать приложение. */
async function allow(db: ApiDb, userId: string, action: keyof typeof LIMITS): Promise<boolean> {
  const { limit, window } = LIMITS[action];
  try {
    return await db.call("rate_limit", [userId, action, limit, window]) !== false;
  } catch {
    return true;
  }
}

async function createAndReport(db: ApiDb, row: InboxInsert): Promise<Response> {
  const id = await db.createInbox(row);
  return json(201, { id, worker_online: await db.workerOnline().catch(() => false) });
}

async function postInboxText(req: Request, userId: string, tgId: number, db: ApiDb): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new BadRequest();
  }
  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || text.trim() === "" || text.trim().length > MAX_TEXT) throw new BadRequest();
  return await createAndReport(db, { user_id: userId, source: "miniapp", text: text.trim(), audio_ref: null, reply_chat_id: tgId });
}

const AUDIO_EXT: Record<string, string> = { "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/webm": "webm" };
const MAX_AUDIO = 2_097_152;

async function postInboxAudio(req: Request, userId: string, tgId: number, d: ApiDeps): Promise<Response> {
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = AUDIO_EXT[mime];
  if (!ext) return json(415, { error: "unsupported_media_type" });
  if (Number(req.headers.get("content-length") ?? "0") > MAX_AUDIO) return json(413, { error: "too_large" });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new BadRequest();
  if (bytes.length > MAX_AUDIO) return json(413, { error: "too_large" });
  const path = `${userId}/${(d.newId ?? (() => crypto.randomUUID()))()}.${ext}`;
  await d.db.uploadAudio(path, bytes, mime);
  try {
    return await createAndReport(d.db, { user_id: userId, source: "miniapp", text: null, audio_ref: `storage:${path}`, reply_chat_id: tgId });
  } catch (e) {
    await d.db.removeAudio(path).catch(() => {});
    throw e;
  }
}

/**
 * Необратимые операции — для них особенно свежая сессия. Удаление записей сюда не входит:
 * оно мягкое и отменяется, а часовое окно заставляло переоткрывать миниапп ради «удалить задачу».
 */
const SENSITIVE = /^\/account\/|^\/settings\/currency$|^\/categories\/[^/]+\/delete$/i;

// Сначала смотрим на путь, потом на метод: /account/export — это GET,
// но он выгружает вообще всё, поэтому ему тоже нужна свежая сессия.
const maxAgeFor = (method: string, path: string) =>
  SENSITIVE.test(path) ? MAX_AGE_SENSITIVE : method !== "POST" ? MAX_AGE_READ : MAX_AGE_WRITE;

/** Один выход — один набор CORS-заголовков. */
const withCors = (res: Response, cors: Record<string, string>) => {
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
};

export async function handleApi(req: Request, d: ApiDeps): Promise<Response> {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return withCors(await handle(req, d), cors);
}

async function handle(req: Request, d: ApiDeps): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, "") || "/";
  const init = req.headers.get("x-init-data") ?? "";
  const auth = await verifyInitData(init, d.botToken, d.nowSec(), maxAgeFor(req.method, path));
  if (!auth) {
    // Подпись верна, но сессия устарела для этого действия — это не «чужой»,
    // и клиенту стоит сказать именно «переоткрой», а не «нет доступа».
    const stale = await verifyInitData(init, d.botToken, d.nowSec(), MAX_AGE_READ);
    return json(401, { error: stale ? "stale_session" : "unauthorized" });
  }

  try {
    const user = await d.db.userByTg(auth.tgId);
    if (!user || !user.is_allowed || !user.onboarded_at) return json(403, { error: "forbidden" });
    if (req.method === "POST" && path === "/inbox") {
      if (!await allow(d.db, user.id, "inbox")) return json(429, { error: "too_many" });
      return await postInboxText(req, user.id, auth.tgId, d.db);
    }
    if (req.method === "POST" && path === "/inbox/audio") {
      if (!await allow(d.db, user.id, "audio")) return json(429, { error: "too_many" });
      return await postInboxAudio(req, user.id, auth.tgId, d);
    }
    if (req.method === "POST" && !await allow(d.db, user.id, "write")) {
      return json(429, { error: "too_many" });
    }
    if (req.method === "POST") {
      const rev = new RegExp(`^/reviews/(${UUID})$`, "i").exec(path);
      if (rev) {
        const { fn, idx, choice } = reviewAnswer(await readJson(req));
        const ok = await d.db.call(fn, [user.id, rev[1].toLowerCase(), idx, choice]);
        return ok === true ? json(200, { ok: true }) : json(404, { error: "not_found" });
      }
      if (path === "/settings/currency") {
        const cur = (await readJson(req)).currency;
        if (!(typeof cur === "string" && /^[A-Z]{3}$/.test(cur))) throw new BadRequest();
        const res = await d.db.call("change_base_currency", [user.id, cur]);
        return res === null ? json(404, { error: "not_found" }) : json(200, res);
      }
      const cr = await createRoute(path, req, user.id);
      if (cr) {
        const id = await d.db.call(cr[0], cr[1]);
        return typeof id === "string" ? json(201, { id }) : json(404, { error: "not_found" });
      }
      const pr = await postRoute(path, req, user.id);
      if (!pr) return json(404, { error: "not_found" });
      const ok = await d.db.call(pr[0], pr[1]);
      return ok === true ? json(200, { ok: true }) : json(404, { error: "not_found" });
    }
    const r = route(path, url.searchParams, user.id);
    if (!r) return json(404, { error: "not_found" });
    const data = await d.db.call(r[0], r[1]);
    return data === null ? json(404, { error: "not_found" }) : json(200, data);
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: "bad_request" });
    if ((e as { code?: string })?.code === "P0001") return json(400, { error: "bad_request" }); // проверка в SQL
    const err = e as { name?: string; message?: string; code?: string };
    console.error("api failed:", err?.name ?? "unknown", err?.message ?? String(e), ...(err?.code ? [`code=${err.code}`] : []));
    return json(500, { error: "server" });
  }
}
