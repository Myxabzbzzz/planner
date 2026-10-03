import { assertEquals } from "jsr:@std/assert@1";
import type { Button, SendOpts, Tg } from "../_shared/telegram.ts";
import type { Daily, DueDigest, Reminder, Weekly } from "./render.ts";
import { type NotifyDb, runNotify } from "./run.ts";

const DAILY: Daily = { date: "2026-10-04", base_currency: "UZS", tasks_done: 1, events_done: 0, tasks_left: [],
  tasks_left_more: 0, spent: 0, month_spent: 0, limit: null, habits: [], tomorrow_events: [], tomorrow_tasks: 0 };
const WEEKLY: Weekly = { from: "2026-09-28", to: "2026-10-04", base_currency: "UZS", expense: 0, prev_expense: 0,
  income: 0, top_categories: [], tasks_done: 0, events_done: 0, habits: [], next_events: 0, next_tasks: 0 };

class FakeDb implements NotifyDb {
  reminders: Reminder[] = [];
  digests: DueDigest[] = [];
  reminded: string[][] = [];
  marked: Array<[string, string, string]> = [];
  async dueReminders() { return this.reminders; }
  async markReminded(ids: string[]) { this.reminded.push(ids); }
  async dueDigests() { return this.digests; }
  async markDigest(u: string, k: string, on: string) { this.marked.push([u, k, on]); }
  async daily() { return DAILY; }
  async weekly() { return WEEKLY; }
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

const rem = (id: string, chat: number): Reminder => ({ item_id: id, chat_id: chat, title: "T", local_time: "15:00", minutes_left: 30 });

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
