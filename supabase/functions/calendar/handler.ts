import { buildIcs, type Feed } from "./ics.ts";

export interface CalendarDb {
  /** null — ссылки нет или доступ закрыт. */
  feed(token: string): Promise<Feed | null>;
}

const TOKEN = /\/calendar\/([0-9a-f]{48})(?:\.ics)?$/;

/** GET …/calendar/<токен>.ics — лента для календаря iPhone или Google. */
export async function handleCalendar(req: Request, db: CalendarDb, now: Date, appUrl?: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const m = TOKEN.exec(new URL(req.url).pathname);
  if (!m) return new Response("not found", { status: 404 });
  const feed = await db.feed(m[1]);
  if (!feed) return new Response("not found", { status: 404 });
  return new Response(req.method === "HEAD" ? null : buildIcs(feed, now, appUrl), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="bt-planner.ics"',
      // календари и так ходят раз в несколько часов; кэш на четверть часа бережёт базу
      "cache-control": "private, max-age=900",
    },
  });
}
