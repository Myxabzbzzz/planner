import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleUpdate } from "./handlers.ts";
import type { Db, NewInbox, User } from "./db.ts";
import type { Button, Tg } from "../_shared/telegram.ts";
import { FakeMenuDb } from "./testing.ts";

const ADMIN = 100;

class FakeDb implements Db {
  users: User[] = [];
  invites = new Set<string>();
  inbox: NewInbox[] = [];
  online = true;
  rates: Record<string, number> | null = { USD: 1, UZS: 11818, GBP: 0.74 };
  reviews: Array<[string, string, number, string]> = [];
  async findUser(tgId: number) { return this.users.find((u) => u.tg_id === tgId) ?? null; }
  async createUser(u: Omit<User, "id" | "onboarded_at" | "base_currency">) {
    const user: User = { ...u, id: `u${this.users.length + 1}`, onboarded_at: null, base_currency: null };
    this.users.push(user);
    return user;
  }
  async isInvited(username: string) { return this.invites.has(username); }
  async invite(username: string) { this.invites.add(username); }
  async revoke(username: string) {
    this.invites.delete(username);
    for (const u of this.users) if (u.tg_username === username && !u.is_admin) u.is_allowed = false;
  }
  async onboard(userId: string, currency: string) {
    const u = this.users.find((x) => x.id === userId)!;
    u.base_currency = currency;
    u.onboarded_at = "2026-10-01T00:00:00Z";
  }
  async knownCurrency(code: string) { return this.rates ? code in this.rates : true; }
  async workerOnline() { return this.online; }
  async createInbox(row: NewInbox) { this.inbox.push(row); return `i${this.inbox.length}`; }
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
}

function setup() {
  const db = new FakeDb();
  const tg = new FakeTg();
  return { db, tg, deps: { db, tg, adminTgId: ADMIN, menu: new FakeMenuDb(), supabaseUrl: "https://x.supabase.co" } };
}

const msg = (fromId: number, extra: Record<string, unknown>, username = "friend") => ({
  message: { chat: { id: fromId, type: "private" }, from: { id: fromId, username, first_name: "Имя" }, ...extra },
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
  await handleUpdate({
    callback_query: { id: "cb1", data: "cur:UZS", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 501 } },
  }, deps);
  assertEquals(db.users[0].base_currency, "UZS");
  assert(tg.edited[0].text.includes("UZS"));
  assertEquals(tg.answered, ["cb1"]);
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
  assertEquals(db.inbox[0], {
    user_id: "u-on", source: "text", text: "кофе 40 000", reply_chat_id: ADMIN, reply_message_id: 501,
  });
});

Deno.test("voice is queued with offline notice when worker is down", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  db.online = false;
  await handleUpdate(msg(ADMIN, { voice: { file_id: "F1", duration: 3 } }), deps);
  assert(tg.sent[0].text.includes("когда ИИ проснётся"));
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
  await handleUpdate({
    callback_query: {
      id: "cb2", data: "rv:abc:0:expense", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 9 },
    },
  }, deps);
  assertEquals(db.reviews, [["u-on", "abc", 0, "expense"]]);
  assert(tg.edited[0].text.includes("Расход"));
});

Deno.test("review callback rejects unknown kind", async () => {
  const { db, deps } = setup();
  onboarded(db);
  await handleUpdate({
    callback_query: { id: "cb3", data: "rv:abc:0:hack", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 9 } },
  }, deps);
  assertEquals(db.reviews.length, 0);
});

Deno.test("review callback rejects prototype keys as kind", async () => {
  const { db, deps } = setup();
  onboarded(db);
  await handleUpdate({
    callback_query: { id: "cb4", data: "rv:abc:0:toString", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 9 } },
  }, deps);
  assertEquals(db.reviews.length, 0);
});

Deno.test("review ack has no hourglass", async () => {
  const { db, tg, deps } = setup();
  onboarded(db);
  await handleUpdate({
    callback_query: { id: "cb5", data: "rv:abc:0:expense", from: { id: ADMIN }, message: { chat: { id: ADMIN }, message_id: 9 } },
  }, deps);
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
