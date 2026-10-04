import type { ApiDb, InboxInsert } from "./db.ts";
import { verifyInitData } from "./initdata.ts";

export type ApiDeps = { db: ApiDb; botToken: string; nowSec: () => number; newId?: () => string };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "x-init-data, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" } });

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

const POST_ROUTES: [RegExp, string, BodyParser][] = [
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
    return [fn, parse(body as Record<string, unknown>, userId, m[1].toLowerCase())];
  }
  return null;
}

const MAX_TEXT = 4000;

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

export async function handleApi(req: Request, d: ApiDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = await verifyInitData(req.headers.get("x-init-data") ?? "", d.botToken, d.nowSec());
  if (!auth) return json(401, { error: "unauthorized" });

  try {
    const user = await d.db.userByTg(auth.tgId);
    if (!user || !user.is_allowed || !user.onboarded_at) return json(403, { error: "forbidden" });
    const url = new URL(req.url);
    const path = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, "") || "/";
    if (req.method === "POST" && path === "/inbox") return await postInboxText(req, user.id, auth.tgId, d.db);
    if (req.method === "POST" && path === "/inbox/audio") return await postInboxAudio(req, user.id, auth.tgId, d);
    if (req.method === "POST") {
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
