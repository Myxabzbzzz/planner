import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleUpdate } from "./handlers.ts";
import type { Db, NewInbox, Queue, User } from "./db.ts";
import type { Button, Tg } from "../_shared/telegram.ts";
import { FakeMenuDb } from "./testing.ts";

const ADMIN = 100;
const INBOX_ID = "11111111-1111-1111-1111-111111111111";
let nextUpdate = 1;

class FakeDb implements Db {
  users: User[] = [];
  invites = new Set<string>();
  inviteIds = new Set<number>();
  inbox: NewInbox[] = [];
  online = true;
  rates: Record<string, number> | null = { USD: 1, UZS: 11818, GBP: 0.74 };
  reviews: Array<[string, string, number, string]> = [];
  seenUpdates = new Set<number>();
  touched: Array<[number, string | null, string]> = [];
  retried: string[] = [];
  cancelled: string[] = [];
  replies: Array<[string, number]> = [];
  failCreateInbox = false;
  queueData: Queue = { waiting: 0, needs_review: 0, failed: 0, oldest: null };
  async findUser(tgId: number) { return this.users.find((u) => u.tg_id === tgId) ?? null; }
  async createUser(u: Omit<User, "id" | "onboarded_at" | "base_currency">) {
    const user: User = { ...u, id: `u${this.users.length + 1}`, onboarded_at: null, base_currency: null };
    this.users.push(user);
    return user;
  }
  async recordUpdate(id: number | undefined) {
    if (id === undefined) return true;
    if (this.seenUpdates.has(id)) return false;
    this.seenUpdates.add(id);
    return true;
  }
  async touchUser(tgId: number, username: string | null, name: string) {
    this.touched.push([tgId, username, name]);
    const u = this.users.find((x) => x.tg_id === tgId);
    if (u) u.tg_username = username;
  }
  async claimInvite(tgId: number, username: string | null) {
    if (this.inviteIds.delete(tgId)) return true;
    return username !== null && this.invites.delete(username);
  }
  async invite(username: string | null, tgId?: number) {
    if (tgId !== undefined) this.inviteIds.add(tgId);
    if (username) this.invites.add(username);
    if (tgId !== undefined) for (const u of this.users) if (u.tg_id === tgId) u.is_allowed = true;
  }
  async revoke(username: string | null, tgId?: number) {
    let n = 0;
    if (username && this.invites.delete(username)) n++;
    if (tgId !== undefined && this.inviteIds.delete(tgId)) n++;
    for (const u of this.users) {
      if (u.is_admin) continue;
      if ((username && u.tg_username === username) || u.tg_id === tgId) {
        u.is_allowed = false;
        n++;
      }
    }
    return n;
  }
  async setInboxReply(id: string, messageId: number) { this.replies.push([id, messageId]); }
  async retryInbox(_u: string, id: string) { this.retried.push(id); return id === INBOX_ID; }
  async cancelInbox(_u: string, id: string) { this.cancelled.push(id); return id === INBOX_ID; }
  async queue() { return this.queueData; }
  async onboard(userId: string, currency: string) {
    const u = this.users.find((x) => x.id === userId)!;
    u.base_currency = currency;
    u.onboarded_at = "2026-10-01T00:00:00Z";
  }
  async knownCurrency(code: string) { return this.rates ? code in this.rates : true; }
  async workerOnline() { return this.online; }
  async createInbox(row: NewInbox) {
    if (this.failCreateInbox) throw new Error("db is down");
    this.inbox.push(row);
    return INBOX_ID;
  }
  async deleteRecords(_u: string, _i: string) { return 2; }
  async resolveTime() { return true; }
  async resolveReview(u: string, i: string, idx: number, kind: string) {
    this.reviews.push([u, i, idx, kind]);
    return true;
  }
}

class FakeTg implements Tg {
  sent: Array<{ chatId: number; text: string; buttons?: Button[][] }> = [];
  edited: Array<{ chatId: number; messageId: number; text: string }> = [];
  answered: string[] = [];
  async sendMessage(chatId: number, text: string, buttons?: Button[][]) {
    this.sent.push({ chatId, text, buttons });
    return { message_id: 500 + this.sent.length };
  }
  async editMessage(chatId: number, messageId: number, text: string) { this.edited.push({ chatId, messageId, text }); }
  async answerCallback(id: string) { this.answered.push(id); }
  deleted: Array<[number, number]> = [];
  async deleteMessage(chatId: number, messageId: number) { this.deleted.push([chatId, messageId]); }
}

function setup() {
  const db = new FakeDb();
  const tg = new FakeTg();
  return { db, tg, deps: { db, tg, adminTgId: ADMIN, menu: new FakeMenuDb(), supabaseUrl: "https://x.supabase.co" } };
}

const msg = (fromId: number, extra: Record<string, unknown>, username = "friend") => ({
  update_id: nextUpdate++,
  message: { chat: { id: fromId, type: "private" }, from: { id: fromId, username, first_name: "Имя" }, ...extra },
});

const cb = (data: string, fromId = ADMIN, messageId = 9) => ({
  update_id: nextUpdate++,
  callback_query: { id: `cb${nextUpdate}`, data, from: { id: fromId, first_name: "Имя" }, message: { chat: { id: fromId }, message_id: messageId } },
});

function onboarded(db: FakeDb, tgId = ADMIN) {
  db.users.push({
    id: "u-on", tg_id: tgId, tg_username: "me", is_allowed: true, is_admin: tgId === ADMIN,
    onboarded_at: "2026-10-01T00:00:00Z", base_currency: "UZS",
  });
}

Deno.test("stranger without invite is refused and not stored", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(7, { text: "/start" }), deps);
  assertEquals(db.users.length, 0);
  assert(tg.sent[0].text.includes("Доступ по приглашению"));
});

Deno.test("admin /start creates admin and asks currency", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(ADMIN, { text: "/start" }, "Owner"), deps);
  assertEquals(db.users[0].is_admin, true);
  assertEquals(db.users[0].tg_username, "owner");
  assert(tg.sent[0].text.includes("базовую валюту"));
  assertEquals(tg.sent[0].buttons![0][0].callback_data, "cur:UZS");
});

Deno.test("invited user is created on /start", async () => {
  const { db, deps } = setup();
  db.invites.add("friend");
  await handleUpdate(msg(7, { text: "/start" }), deps);
  assertEquals(db.users.length, 1);
  assertEquals(db.users[0].is_admin, false);
});

Deno.test("currency button onboards and edits message", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(ADMIN, { text: "/start" }), deps);
  await handleUpdate(cb("cur:UZS", ADMIN, 501), deps);
  assertEquals(db.users[0].base_currency, "UZS");
  assert(tg.edited[0].text.includes("UZS"));
  assertEquals(tg.answered.length, 1);
});

Deno.test("typed currency code onboards", async () => {
  const { db, deps } = setup();
  await handleUpdate(msg(ADMIN, { text: "/start" }), deps);
  await handleUpdate(msg(ADMIN, { text: " gbp " }), deps);
  assertEquals(db.users[0].base_currency, "GBP");
});

Deno.test("unknown currency code is rejected", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(ADMIN, { text: "/start" }), deps);
  await handleUpdate(msg(ADMIN, { text: "XYZ" }), deps);
  assertEquals(db.users[0].base_currency, null);
  assert(tg.sent.at(-1)!.text.includes("Не знаю валюту XYZ"));
});

Deno.test("text before onboarding asks for currency, no inbox", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(ADMIN, { text: "/start" }), deps);
  await handleUpdate(msg(ADMIN, { text: "кофе 40 000" }), deps);
  assertEquals(db.inbox.length, 0);
  assert(tg.sent.at(-1)!.text.includes("базовую валюту"));
});

Deno.test("text goes to inbox with ack ids when worker online", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(msg(ADMIN, { text: "кофе 40 000" }), deps);
  assertEquals(tg.sent[0].text, "⏳ Разбираю…");
  assertEquals(db.inbox[0], { user_id: "u-on", source: "text", text: "кофе 40 000", reply_chat_id: ADMIN });
  assertEquals(db.replies, [[INBOX_ID, 501]]);
});

Deno.test("voice is queued with offline notice when worker is down", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  db.online = false;
  await handleUpdate(msg(ADMIN, { voice: { file_id: "F1", duration: 3 } }), deps);
  assert(tg.sent[0].text.includes("когда ИИ проснётся"));
  assert(!tg.sent[0].text.includes("В очереди"));
  assertEquals(db.inbox[0].source, "voice");
  assertEquals(db.inbox[0].audio_ref, "F1");
});

Deno.test("/allow is admin-only", async () => {
  const { db, tg, deps } = setup();
  onboarded(db, 7);
  await handleUpdate(msg(7, { text: "/allow @pal" }), deps);
  assertEquals(db.invites.size, 0);
  assert(tg.sent[0].text.includes("только для владельца"));
});

Deno.test("admin /allow and /deny manage invites", async () => {
  const { db, deps } = setup();
  onboarded(db);
  await handleUpdate(msg(ADMIN, { text: "/allow @Pal" }), deps);
  assert(db.invites.has("pal"));
  await handleUpdate(msg(ADMIN, { text: "/deny pal" }), deps);
  assert(!db.invites.has("pal"));
});

Deno.test("review callback resolves review", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:expense`), deps);
  assertEquals(db.reviews, [["u-on", INBOX_ID, 0, "expense"]]);
  assert(tg.edited[0].text.includes("Расход"));
});

Deno.test("review callback rejects unknown kind", async () => {
  const { db, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:hack`), deps);
  assertEquals(db.reviews.length, 0);
});

Deno.test("review callback rejects prototype keys as kind", async () => {
  const { db, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:toString`), deps);
  assertEquals(db.reviews.length, 0);
});

Deno.test("review ack has no hourglass", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:expense`), deps);
  assert(!tg.edited[0].text.includes("⏳"));
});

Deno.test("open access: stranger gets in and is asked for currency", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(7, { text: "/start" }, "stranger"), { ...deps, openAccess: true });
  assertEquals(db.users.length, 1);
  assertEquals(db.users[0].is_allowed, true);
  assertEquals(db.users[0].is_admin, false);
  assert(tg.sent[0].text.includes("базовую валюту"));
});

Deno.test("open access: a denied user stays denied", async () => {
  const { db, tg, deps } = setup();
  db.users.push({
    id: "u-x", tg_id: 7, tg_username: "stranger", is_allowed: false, is_admin: false,
    onboarded_at: "2026-10-01T00:00:00Z", base_currency: "UZS",
  });
  await handleUpdate(msg(7, { text: "кофе 40 000" }, "stranger"), { ...deps, openAccess: true });
  assert(tg.sent[0].text.includes("Доступ по приглашению"));
  assertEquals(db.inbox.length, 0);
});

Deno.test("#13 a repeated update_id is ignored: no double ack, no double inbox row", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  const u = msg(ADMIN, { text: "кофе 40 000" });
  await handleUpdate(u, deps);
  await handleUpdate(u, deps);
  assertEquals(db.inbox.length, 1);
  assertEquals(tg.sent.length, 1);
});

Deno.test("#12 a failing insert tells the user instead of leaving an eternal hourglass", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  db.failCreateInbox = true;
  await handleUpdate(msg(ADMIN, { text: "кофе 40 000" }), deps);
  assertEquals(db.inbox.length, 0);
  assertEquals(tg.sent.length, 1);
  assert(tg.sent[0].text.includes("Не смог принять запись"));
  assert(!tg.sent[0].text.includes("⏳ Разбираю"));
});

Deno.test("#12 ack carries a cancel button and is linked to the row after the insert", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(msg(ADMIN, { text: "кофе" }), deps);
  assertEquals(tg.sent[0].buttons, [[{ text: "🚫 Отменить", callback_data: `cxl:${INBOX_ID}` }]]);
  assertEquals(db.replies, [[INBOX_ID, 501]]);
});

Deno.test("#5 resolving a review promises to write, not that it is written", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:event`), deps);
  assertEquals(tg.edited[0].text, "Принял: 📅 Встреча — записываю…");
  db.online = false;
  await handleUpdate(cb(`rt:${INBOX_ID}:0:1500`), deps);
  assertEquals(tg.edited[1].text, "Принял: 📅 15:00 — запишу, когда ИИ проснётся.");
});

Deno.test("#5 skipping stays a plain skip", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rv:${INBOX_ID}:0:drop`), deps);
  assertEquals(tg.edited[0].text, "🗑 Пропущено.");
});

Deno.test("#11 retry button puts the row back in the queue", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`rtx:${INBOX_ID}`), deps);
  assertEquals(db.retried, [INBOX_ID]);
  assert(tg.edited[0].text.includes("Пробую разобрать снова"));
});

Deno.test("#11 retry of an already-queued row says so instead of lying", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb("rtx:22222222-2222-2222-2222-222222222222"), deps);
  assertEquals(tg.edited.length, 0);
});

Deno.test("#10 cancel removes the record", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb(`cxl:${INBOX_ID}`), deps);
  assertEquals(db.cancelled, [INBOX_ID]);
  assert(tg.edited[0].text.includes("убрана"));
});

Deno.test("#38 a malformed id in a callback answers instead of throwing", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  for (const data of ["del:abc", "rtx:abc", "cxl:abc", "rv:abc:0:expense", "rt:abc:0:1500"]) {
    await handleUpdate(cb(data), deps);
  }
  assertEquals(tg.edited.length, 0);
  assertEquals(tg.answered.length, 5);
  assertEquals(db.reviews.length, 0);
});

Deno.test("#7 username is refreshed on every update, so /deny by the fresh nick works", async () => {
  const { db, deps } = setup();
  db.users.push({
    id: "u-f", tg_id: 7, tg_username: "old_nick", is_allowed: true, is_admin: false,
    onboarded_at: "2026-10-01T00:00:00Z", base_currency: "UZS",
  });
  onboarded(db);
  await handleUpdate(msg(7, { text: "привет" }, "new_nick"), deps);
  assertEquals(db.users[0].tg_username, "new_nick");
  await handleUpdate(msg(ADMIN, { text: "/deny @new_nick" }), deps);
  assertEquals(db.users[0].is_allowed, false);
});

Deno.test("#7 invite is consumed on first login, a recycled nick gets nothing", async () => {
  const { db, deps } = setup();
  db.invites.add("pal");
  await handleUpdate(msg(7, { text: "/start" }, "pal"), deps);
  assertEquals(db.users.length, 1);
  await handleUpdate(msg(8, { text: "/start" }, "pal"), deps);
  assertEquals(db.users.length, 1);
});

Deno.test("#7 admin can allow by numeric telegram id", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(msg(ADMIN, { text: "/allow 123456789" }), deps);
  assert(db.inviteIds.has(123456789));
  assert(tg.sent[0].text.includes("id 123456789"));
});

Deno.test("#7 /deny of someone who never had access says so", async () => {
  const { tg, deps, db } = setup();
  onboarded(db);
  await handleUpdate(msg(ADMIN, { text: "/deny @nobody" }), deps);
  assert(tg.sent[0].text.includes("и так без доступа"));
});

Deno.test("#26 a stranger can ask for access and the owner gets a button", async () => {
  const { db, tg, deps } = setup();
  await handleUpdate(msg(7, { text: "/start" }, "stranger"), deps);
  assertEquals(tg.sent[0].buttons, [[{ text: "✋ Запросить доступ", callback_data: "ask" }]]);
  await handleUpdate(cb("ask", 7), deps);
  const toOwner = tg.sent.find((m) => m.chatId === ADMIN)!;
  assert(toOwner.text.includes("Просит доступ"));
  assertEquals(toOwner.buttons, [[{ text: "✅ Разрешить", callback_data: "inv:7" }]]);
  assertEquals(db.users.length, 0);
});

Deno.test("#26 the owner's allow button invites by id and tells the person", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate(cb("inv:7"), deps);
  assert(db.inviteIds.has(7));
  assert(tg.edited[0].text.includes("Доступ открыт"));
  assert(tg.sent.some((m) => m.chatId === 7 && m.text.includes("Доступ открыт")));
  await handleUpdate(msg(7, { text: "/start" }, "stranger"), deps);
  assertEquals(db.users.length, 2);
});

Deno.test("#26 only the owner can press the allow button", async () => {
  const { db, tg, deps } = setup();
  onboarded(db, 7);
  await handleUpdate(cb("inv:555555", 7), deps);
  assertEquals(db.inviteIds.size, 0);
  assertEquals(tg.edited.length, 0);
});

// #10: очередь перестала быть невидимой
Deno.test("#10 an offline ack says how much is already queued", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  db.online = false;
  db.queueData = { waiting: 12, needs_review: 0, failed: 0, oldest: "2026-10-01T00:00:00Z" };
  await handleUpdate(msg(ADMIN, { text: "кофе" }), deps);
  assert(tg.sent[0].text.includes("В очереди уже 12"));
});
