import { assertEquals } from "jsr:@std/assert@1";
import { type CaptureDb, type CaptureUser } from "./db.ts";
import { handleCapture, MAX_TEXT } from "./handler.ts";

const TOKEN = "c".repeat(64);

class FakeCaptureDb implements CaptureDb {
  user: CaptureUser | null = { id: "u1", tg_id: 555, is_allowed: true, onboarded_at: "2026-10-01T00:00:00Z" };
  online = true;
  rows: Array<{ user_id: string; source: "shortcut"; text: string; reply_chat_id: number }> = [];
  seenToken: string | null = null;
  async userByToken(token: string) { this.seenToken = token; return token === TOKEN ? this.user : null; }
  async workerOnline() { return this.online; }
  async createInbox(row: { user_id: string; source: "shortcut"; text: string; reply_chat_id: number }) { this.rows.push(row); }
}

const req = (body: string, headers: Record<string, string> = {}, method = "POST") =>
  new Request("https://x/functions/v1/capture", { method, headers, body: method === "GET" ? undefined : body });
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function call(r: Request, db = new FakeCaptureDb()) {
  const res = await handleCapture(r, db);
  return { status: res.status, message: (await res.json()).message as string, db };
}

Deno.test("202 json, worker online", async () => {
  const { status, message, db } = await call(req(JSON.stringify({ text: "  кофе 40 000 " }), auth));
  assertEquals([status, message], [202, "Записано ✅"]);
  assertEquals(db.rows, [{ user_id: "u1", source: "shortcut", text: "кофе 40 000", reply_chat_id: 555 }]);
});

Deno.test("202 text/plain, worker offline", async () => {
  const db = new FakeCaptureDb();
  db.online = false;
  const { status, message } = await call(req("купить молоко", { authorization: `Bearer ${TOKEN}`, "content-type": "text/plain" }), db);
  assertEquals([status, message], [202, "Записано, разберу, когда ИИ проснётся"]);
  assertEquals(db.rows[0].text, "купить молоко");
});

Deno.test("202 even when workerOnline throws after insert", async () => {
  const db = new FakeCaptureDb();
  db.workerOnline = async () => { throw new Error("db down"); };
  const { status, message } = await call(req(JSON.stringify({ text: "x" }), auth), db);
  assertEquals([status, message], [202, "Записано, разберу, когда ИИ проснётся"]);
  assertEquals(db.rows.length, 1);
});

Deno.test("token is case-insensitive and tolerates extra spaces", async () => {
  const { status, db } = await call(req(JSON.stringify({ text: "x" }), {
    authorization: `Bearer   ${TOKEN.toUpperCase()}`, "content-type": "application/json",
  }));
  assertEquals(status, 202);
  assertEquals(db.seenToken, TOKEN);
});

Deno.test("401 without or with wrong token", async () => {
  assertEquals((await call(req("x", {}))).status, 401);
  const r = await call(req("x", { authorization: `Bearer ${"d".repeat(64)}` }));
  assertEquals([r.status, r.message], [401, "Неверный токен"]);
});

Deno.test("403 when not allowed or not onboarded", async () => {
  const db = new FakeCaptureDb();
  db.user!.onboarded_at = null;
  const r = await call(req(JSON.stringify({ text: "x" }), auth), db);
  assertEquals([r.status, r.message], [403, "Нет доступа"]);
  assertEquals(db.rows.length, 0);
});

Deno.test("400 empty, too long, bad json", async () => {
  assertEquals((await call(req(JSON.stringify({ text: "   " }), auth))).status, 400);
  assertEquals((await call(req(JSON.stringify({ text: "я".repeat(MAX_TEXT + 1) }), auth))).status, 400);
  const r = await call(req("{not json", auth));
  assertEquals([r.status, r.message], [400, "Пустой или слишком длинный текст"]);
});

Deno.test("405 on GET", async () => {
  const r = await call(req("", {}, "GET"));
  assertEquals([r.status, r.message], [405, "Только POST"]);
});
