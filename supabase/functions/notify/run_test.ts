import { assertEquals } from "jsr:@std/assert@1";
import type { Button, SendOpts, Tg } from "../_shared/telegram.ts";
import type { Daily, DueDigest, Reminder, ReviewPing, SleepingQueue, Weekly } from "./render.ts";
import { type NotifyDb, runNotify } from "./run.ts";

const DAILY: Daily = { date: "2026-10-04", base_currency: "UZS", tasks_done: 1, events_done: 0, events_past: 0,
  tasks_left: [], tasks_left_more: 0, spent: 0, month_spent: 0, limit: null, habits: [], tomorrow_events: [],
  tomorrow_tasks: 0 };
const WEEKLY: Weekly = { from: "2026-09-28", to: "2026-10-04", base_currency: "UZS", expense: 0, prev_expense: 0,
  income: 0, top_categories: [], tasks_done: 0, events_done: 0, events_past: 0, habits: [], next_events: 0,
  next_tasks: 0 };

class FakeDb implements NotifyDb {
  reminders: Reminder[] = [];
  digests: DueDigest[] = [];
  reminded: string[][] = [];
  marked: Array<[string, string, string]> = [];
  dailyFor: Array<[string, string]> = [];
  weeklyFor: Array<[string, string]> = [];
  reviews: ReviewPing[] = [];
  pinged: string[][] = [];
  sleeping: SleepingQueue[] = [];
  warned: string[][] = [];
  purged = 0;
  async dueReminders() { return this.reminders; }
  async markReminded(ids: string[]) { this.reminded.push(ids); }
  async dueDigests() { return this.digests; }
  async markDigest(u: string, k: string, on: string) { this.marked.push([u, k, on]); }
  async daily(u: string, on: string) { this.dailyFor.push([u, on]); return DAILY; }
  async weekly(u: string, on: string) { this.weeklyFor.push([u, on]); return WEEKLY; }
  async staleReviews() { return this.reviews; }
  async markReviewPinged(ids: string[]) { this.pinged.push(ids); }
  async sleepingQueues() { return this.sleeping; }
  async markQueueWarned(ids: string[]) { this.warned.push(ids); }
  async purgeUpdates() { this.purged++; }
}

class FakeTg implements Tg {
  sent: Array<{ chat: number; text: string; buttons?: Button[][] }> = [];
  failFor = new Map<number, string>();
  async sendMessage(chat: number, text: string, buttons?: Button[][], _o?: SendOpts) {
    const err = this.failFor.get(chat);
    if (err) throw new Error(`telegram sendMessage: ${err}`);
    this.sent.push({ chat, text, buttons });
    return { message_id: 1 };
  }
  async editMessage() {}
  async answerCallback() {}
}

const rem = (id: string, chat: number): Reminder => ({
  item_id: id, chat_id: chat, kind: "event", title: "T", local_time: "15:00", minutes_left: 30,
});

Deno.test("reminders: sent ones and blocked ones are marked, failed ones are not", async () => {
  const db = new FakeDb();
  db.reminders = [rem("a", 1), rem("b", 2), rem("c", 3)];
  const tg = new FakeTg();
  tg.failFor.set(2, "Forbidden: bot was blocked by the user");
  tg.failFor.set(3, "Too Many Requests: retry after 5");
  const r = await runNotify({ db, tg });
  assertEquals(r.reminders, 1);
  assertEquals(db.reminded, [["a", "b"]]);
});

Deno.test("digests: daily then weekly, button, marked with local date; one failure doesn't stop others", async () => {
  const db = new FakeDb();
  db.digests = [
    { user_id: "u1", chat_id: 1, kind: "daily", local_date: "2026-10-05" },
    { user_id: "u1", chat_id: 1, kind: "weekly", local_date: "2026-10-05" },
    { user_id: "u2", chat_id: 2, kind: "daily", local_date: "2026-10-05" },
    { user_id: "u3", chat_id: 3, kind: "daily", local_date: "2026-10-05" },
  ];
  const tg = new FakeTg();
  tg.failFor.set(2, "Bad Gateway");
  const r = await runNotify({ db, tg, miniappUrl: "https://m.app" });
  assertEquals(r.digests, 3);
  assertEquals(db.marked, [["u1", "daily", "2026-10-05"], ["u1", "weekly", "2026-10-05"], ["u3", "daily", "2026-10-05"]]);
  assertEquals(tg.sent[0].text.startsWith("🌙 Итоги дня"), true);
  assertEquals(tg.sent[1].text.startsWith("📊 Неделя"), true);
  assertEquals(tg.sent[0].buttons, [[{ text: "📱 Открыть планер", web_app: { url: "https://m.app" } }]]);
});

Deno.test("no miniapp url → no button", async () => {
  const db = new FakeDb();
  db.digests = [{ user_id: "u1", chat_id: 1, kind: "daily", local_date: "2026-10-05" }];
  const tg = new FakeTg();
  await runNotify({ db, tg });
  assertEquals(tg.sent[0].buttons, undefined);
});

// #15: сводку надо считать за день из due_digests, а не «за сегодня»
Deno.test("digests are computed for the date they are due for", async () => {
  const db = new FakeDb();
  db.digests = [
    { user_id: "u1", chat_id: 1, kind: "daily", local_date: "2026-10-04" },
    { user_id: "u1", chat_id: 1, kind: "weekly", local_date: "2026-10-04" },
  ];
  await runNotify({ db, tg: new FakeTg() });
  assertEquals(db.dailyFor, [["u1", "2026-10-04"]]);
  assertEquals(db.weeklyFor, [["u1", "2026-10-04"]]);
});

// #8
Deno.test("stale reviews are re-pinged with a cancel button and marked", async () => {
  const db = new FakeDb();
  db.reviews = [
    { inbox_id: "a", user_id: "u1", chat_id: 1, pending: 2, sample: "кофе" },
    { inbox_id: "b", user_id: "u2", chat_id: 2, pending: 1, sample: null },
  ];
  const tg = new FakeTg();
  tg.failFor.set(2, "Too Many Requests: retry after 5");
  const r = await runNotify({ db, tg });
  assertEquals(r.pings, 1);
  assertEquals(db.pinged, [["a"]]);
  assertEquals(tg.sent[0].buttons, [[{ text: "🚫 Убрать запись", callback_data: "cxl:a" }]]);
});

Deno.test("a blocked chat still marks the review as pinged", async () => {
  const db = new FakeDb();
  db.reviews = [{ inbox_id: "a", user_id: "u1", chat_id: 1, pending: 1, sample: null }];
  const tg = new FakeTg();
  tg.failFor.set(1, "Forbidden: bot was blocked by the user");
  await runNotify({ db, tg });
  assertEquals(db.pinged, [["a"]]);
});

// #10
Deno.test("a sleeping worker is reported once and marked", async () => {
  const db = new FakeDb();
  db.sleeping = [{ user_id: "u1", chat_id: 1, queued: 12, oldest_hours: 30 }];
  const tg = new FakeTg();
  const r = await runNotify({ db, tg });
  assertEquals(r.queues, 1);
  assertEquals(db.warned, [["u1"]]);
  assertEquals(tg.sent[0].text.includes("12 записей"), true);
});

// #13
Deno.test("the processed-updates log is purged on every run", async () => {
  const db = new FakeDb();
  await runNotify({ db, tg: new FakeTg() });
  assertEquals(db.purged, 1);
});
