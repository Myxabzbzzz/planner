import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleUpdate } from "./handlers.ts";
import { parseAmount } from "./menu.ts";
import { MENU_ROWS } from "./keyboard.ts";
import type { Db, NewInbox, User } from "./db.ts";
import type { Button, SendOpts, Tg } from "../_shared/telegram.ts";
import { FakeMenuDb, HABIT_ID, TASK_ID } from "./testing.ts";

const ME = 100;

class MiniDb implements Db {
  user: User = {
    id: "u1", tg_id: ME, tg_username: "me", is_allowed: true, is_admin: true,
    onboarded_at: "2026-10-01T00:00:00Z", base_currency: "UZS", pending_action: null,
  };
  inbox: NewInbox[] = [];
  times: Array<[string, string, number, string]> = [];
  async resolveTime(u: string, i: string, idx: number, choice: string) { this.times.push([u, i, idx, choice]); return true; }
  async findUser(tgId: number) { return tgId === ME ? this.user : null; }
  async createUser(): Promise<User> { throw new Error("unused"); }
  async isInvited() { return false; }
  async invite() {}
  async revoke() {}
  async onboard() {}
  async knownCurrency() { return true; }
  async workerOnline() { return true; }
  async createInbox(row: NewInbox) { this.inbox.push(row); return "i1"; }
  async deleteRecords() { return 0; }
  async resolveReview() { return false; }
}

class RecTg implements Tg {
  sent: Array<{ text: string; buttons?: Button[][]; opts?: SendOpts }> = [];
  edited: Array<{ messageId: number; text: string; buttons?: Button[][]; opts?: SendOpts }> = [];
  answered: Array<[string, string | undefined]> = [];
  async sendMessage(_c: number, text: string, buttons?: Button[][], opts?: SendOpts) {
    this.sent.push({ text, buttons, opts });
    return { message_id: 900 + this.sent.length };
  }
  async editMessage(_c: number, messageId: number, text: string, buttons?: Button[][], opts?: SendOpts) {
    this.edited.push({ messageId, text, buttons, opts });
  }
  async answerCallback(id: string, text?: string) { this.answered.push([id, text]); }
}

function setup() {
  const db = new MiniDb();
  const tg = new RecTg();
  const menu = new FakeMenuDb();
  return { db, tg, menu, deps: { db, tg, adminTgId: ME, menu, supabaseUrl: "https://x.supabase.co" } };
}

const text = (t: string) => ({ message: { chat: { id: ME, type: "private" }, from: { id: ME, username: "me" }, text: t } });
const cb = (data: string) => ({
  callback_query: { id: "cb", data, from: { id: ME }, message: { chat: { id: ME }, message_id: 77 } },
});

Deno.test("parseAmount", () => {
  assertEquals(parseAmount("5 000 000"), 5000000);
  assertEquals(parseAmount("5 млн"), 5000000);
  assertEquals(parseAmount("1,5 млн"), 1500000);
  assertEquals(parseAmount("300к"), 300000);
  assertEquals(parseAmount("300 тыс"), 300000);
  assertEquals(parseAmount("5.000.000"), 5000000);
  assertEquals(parseAmount("0"), 0);
  assertEquals(parseAmount("абв"), null);
  assertEquals(parseAmount("кофе 40 000"), null);
});

Deno.test("menu button shows summary and never queues inbox", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(text("📅 Сегодня"), deps);
  assert(tg.sent[0].text.startsWith("📅 Сегодня"));
  assertEquals(tg.sent[0].buttons, [[{ text: "✔️ зарядка", callback_data: `hab:${HABIT_ID}:t` }]]);
  assertEquals(db.inbox.length, 0);
});

Deno.test("tasks button lists tasks with done buttons", async () => {
  const { tg, deps } = setup();
  await handleUpdate(text("☑️ Задачи"), deps);
  assertEquals(tg.sent[0].buttons, [[{ text: "✅ 1", callback_data: `done:${TASK_ID}` }]]);
});

Deno.test("app button says coming soon", async () => {
  const { tg, deps } = setup();
  await handleUpdate(text("📱 Приложение"), deps);
  assert(tg.sent[0].text.includes("появится скоро"));
});

Deno.test("app button opens mini app when url is configured", async () => {
  const { tg, deps } = setup();
  await handleUpdate(text("📱 Приложение"), { ...deps, miniappUrl: "https://planner.vercel.app" });
  assertEquals(tg.sent[0].text, "Открой планер 👇");
  assertEquals(tg.sent[0].buttons, [[{ text: "Открыть", web_app: { url: "https://planner.vercel.app" } }]]);
});

Deno.test("/menu sends reply keyboard", async () => {
  const { tg, deps } = setup();
  await handleUpdate(text("/menu"), deps);
  assertEquals(tg.sent[0].opts?.replyKeyboard, MENU_ROWS);
});

Deno.test("menu button before onboarding asks for currency", async () => {
  const { db, tg, deps } = setup();
  db.user.onboarded_at = null;
  await handleUpdate(text("📅 Сегодня"), deps);
  assert(tg.sent[0].text.includes("базовую валюту"));
});

Deno.test("pending limit: valid amount saves and clears", async () => {
  const { db, tg, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("5 млн"), deps);
  assertEquals(menu.limits, [5000000]);
  assertEquals(menu.pending, [null]);
  assertEquals(tg.sent[0].text, "✅ Лимит на месяц: 5 000 000 сум");
  assertEquals(db.inbox.length, 0);
});

Deno.test("pending limit: zero removes", async () => {
  const { db, tg, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("0"), deps);
  assertEquals(menu.limits, [0]);
  assertEquals(tg.sent[0].text, "✅ Лимит убран.");
});

Deno.test("pending limit: non-amount text clears pending and is recorded", async () => {
  const { db, tg, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("абв"), deps);
  assertEquals(menu.limits, []);
  assertEquals(menu.pending, [null]);
  assertEquals(tg.sent[0].text, "Лимит не изменил.");
  assertEquals(db.inbox.length, 1);
  assertEquals(db.inbox[0].text, "абв");
});

Deno.test("/menu while pending clears pending", async () => {
  const { db, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("/menu"), deps);
  assertEquals(menu.pending, [null]);
});

Deno.test("/start while pending clears pending", async () => {
  const { db, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("/start"), deps);
  assertEquals(menu.pending, [null]);
});

Deno.test("menu callback before onboarding is refused", async () => {
  const { db, tg, menu, deps } = setup();
  db.user.onboarded_at = null;
  await handleUpdate(cb(`done:${TASK_ID}`), deps);
  assertEquals(tg.answered, [["cb", "Нет доступа"]]);
  assertEquals(menu.completed, []);
});

Deno.test("edit 'message is not modified' is ignored", async () => {
  const { tg, deps } = setup();
  tg.editMessage = async () => { throw new Error("Bad Request: message is not modified"); };
  await handleUpdate(cb(`done:${TASK_ID}`), deps);
  assertEquals(tg.answered[0], ["cb", "Готово ✅"]);
});

Deno.test("edit other errors are rethrown", async () => {
  const { tg, deps } = setup();
  tg.editMessage = async () => { throw new Error("boom"); };
  let threw = false;
  try { await handleUpdate(cb(`done:${TASK_ID}`), deps); } catch { threw = true; }
  assert(threw);
});

Deno.test("parseAmount rejects absurd magnitudes", () => {
  assertEquals(parseAmount("1000000000000000"), null);
});

Deno.test("pending limit: voice still goes to inbox", async () => {
  const { db, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate({ message: { chat: { id: ME, type: "private" }, from: { id: ME }, voice: { file_id: "F" } } }, deps);
  assertEquals(db.inbox[0].source, "voice");
});

Deno.test("menu button while pending clears pending", async () => {
  const { db, menu, deps } = setup();
  db.user.pending_action = "limit";
  await handleUpdate(text("💸 Деньги"), deps);
  assertEquals(menu.pending, [null]);
});

Deno.test("done callback completes and re-renders tasks", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb(`done:${TASK_ID}`), deps);
  assertEquals(menu.completed, [TASK_ID]);
  assertEquals(tg.edited[0].messageId, 77);
  assert(tg.edited[0].text.startsWith("☑️ Задачи"));
});

Deno.test("done callback with bad id is stale", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb("done:not-a-uuid"), deps);
  assertEquals(menu.completed, []);
  assertEquals(tg.answered, [["cb", "Уже неактуально"]]);
});

Deno.test("hab callback from habits view re-renders habits", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb(`hab:${HABIT_ID}:h`), deps);
  assertEquals(menu.logged, [HABIT_ID]);
  assert(tg.edited[0].text.startsWith("🔁 Привычки"));
});

Deno.test("hab callback twice still answers and re-renders", async () => {
  const { tg, deps } = setup();
  await handleUpdate(cb(`hab:${HABIT_ID}:t`), deps);
  await handleUpdate(cb(`hab:${HABIT_ID}:t`), deps);
  assertEquals(tg.edited.length, 2);
  assert(tg.edited[1].text.startsWith("📅 Сегодня"));
});

Deno.test("set:limit asks for amount and sets pending", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb("set:limit"), deps);
  assertEquals(menu.pending, ["limit"]);
  assertEquals(tg.sent[0].text, "Пришли сумму в UZS на месяц. 0 — убрать лимит.");
});

Deno.test("tz callback sets known zone, rejects unknown", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb("tz:moscow"), deps);
  assertEquals(menu.tzSet, ["Europe/Moscow"]);
  assert(tg.edited[0].text.startsWith("⚙️ Настройки"));
  await handleUpdate(cb("tz:mars"), deps);
  assertEquals(menu.tzSet, ["Europe/Moscow"]);
  assertEquals(tg.answered.at(-1), ["cb", "Уже неактуально"]);
});

Deno.test("set:tap queues shortcut file job", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb("set:tap"), deps);
  assertEquals(menu.jobs, [ME]);
  assert(tg.sent[0].text.startsWith("⏳ Собираю команду"));
  assertEquals(tg.sent[0].buttons!.flat().map((b) => b.callback_data), ["tap:new", "tap:manual"]);
});

Deno.test("set:tap when worker offline warns", async () => {
  const { tg, menu, deps } = setup();
  menu.online = false;
  await handleUpdate(cb("set:tap"), deps);
  assert(tg.sent[0].text.includes("когда Mac проснётся"));
});

Deno.test("tap:new rotates token and queues a new file", async () => {
  const { tg, menu, deps } = setup();
  await handleUpdate(cb("tap:new"), deps);
  assertEquals(menu.rotated, 1);
  assertEquals(menu.jobs, [ME]);
  assert(tg.edited[0].text.startsWith("⏳ Собираю команду"));
});

Deno.test("tap:manual sends html guide with token", async () => {
  const { tg, deps } = setup();
  await handleUpdate(cb("tap:manual"), deps);
  assertEquals(tg.sent[0].opts?.html, true);
  assert(tg.sent[0].text.includes("https://x.supabase.co/functions/v1/capture"));
  assert(tg.sent[0].text.includes("a".repeat(64)));
});

Deno.test("rt callback resolves time and edits message", async () => {
  const { db, tg, deps } = setup();
  const id = "40000000-0000-0000-0000-000000000001";
  await handleUpdate(cb(`rt:${id}:0:1500`), deps);
  assertEquals(db.times, [["u1", id, 0, "1500"]]);
  assertEquals(tg.edited[0].text, "Принял: 📅 15:00");
  await handleUpdate(cb(`rt:${id}:1:none`), deps);
  assertEquals(tg.edited[1].text, "Принял: ☑️ без времени");
});

Deno.test("rt callback rejects bad choice and bad id", async () => {
  const { db, deps } = setup();
  await handleUpdate(cb("rt:40000000-0000-0000-0000-000000000001:0:2599"), deps);
  await handleUpdate(cb("rt:not-a-uuid:0:1500"), deps);
  assertEquals(db.times, []);
});

