import type { ApiDb } from "./db.ts";
import { verifyInitData } from "./initdata.ts";

export type ApiDeps = { db: ApiDb; botToken: string; nowSec: () => number };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "x-init-data, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
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
    case "/notes": {
      const query = (q.get("q") ?? "").slice(0, 100);
      const before = q.get("before");
      if (before && !CURSOR.test(before)) throw new BadRequest();
      return ["api_notes", [userId, query || null, before || null]];
    }
  }
  return null;
}

export async function handleApi(req: Request, d: ApiDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const auth = await verifyInitData(req.headers.get("x-init-data") ?? "", d.botToken, d.nowSec());
  if (!auth) return json(401, { error: "unauthorized" });

  try {
    const user = await d.db.userByTg(auth.tgId);
    if (!user || !user.is_allowed || !user.onboarded_at) return json(403, { error: "forbidden" });
    const url = new URL(req.url);
    const path = url.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, "") || "/";
    const r = route(path, url.searchParams, user.id);
    if (!r) return json(404, { error: "not_found" });
    return json(200, await d.db.call(r[0], r[1]));
  } catch (e) {
    if (e instanceof BadRequest) return json(400, { error: "bad_request" });
    console.error("api failed:", e instanceof Error ? e.name : "unknown");
    return json(500, { error: "server" });
  }
}
