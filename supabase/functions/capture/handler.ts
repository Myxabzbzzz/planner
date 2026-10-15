import type { CaptureDb } from "./db.ts";

export const MAX_TEXT = 4000;
const BAD_TEXT = "Пустой или слишком длинный текст";

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function handleCapture(req: Request, db: CaptureDb): Promise<Response> {
  if (req.method !== "POST") return reply(405, "Только POST");
  const m = /^Bearer\s+([0-9a-f]{64})\s*$/i.exec(req.headers.get("authorization") ?? "");
  if (!m) return reply(401, "Неверный токен");
  const user = await db.userByToken(m[1].toLowerCase());
  if (!user) return reply(401, "Неверный токен");
  if (!user.is_allowed || !user.onboarded_at) return reply(403, "Нет доступа");

  let text: string;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body = await req.json();
      text = typeof body?.text === "string" ? body.text : "";
    } catch {
      return reply(400, BAD_TEXT);
    }
  } else {
    text = await req.text();
  }
  text = text.trim();
  if (!text || text.length > MAX_TEXT) return reply(400, BAD_TEXT);

  if (!await db.rateLimit(user.id)) return reply(429, "Слишком часто. Подожди пару минут");
  await db.createInbox({ user_id: user.id, source: "shortcut", text, reply_chat_id: user.tg_id });
  return reply(202, (await db.workerOnline().catch(() => false)) ? "Записано ✅" : "Записано, разберу, когда ИИ проснётся");
}
