import type { Button, Tg } from "../_shared/telegram.ts";
import {
  type Daily,
  type DueDigest,
  type Reminder,
  renderDaily,
  renderReminder,
  renderReviewPing,
  renderSleeping,
  renderWeekly,
  type ReviewPing,
  type SleepingQueue,
  type Weekly,
} from "./render.ts";

export interface NotifyDb {
  dueReminders(): Promise<Reminder[]>;
  markReminded(ids: string[]): Promise<void>;
  dueDigests(): Promise<DueDigest[]>;
  markDigest(userId: string, kind: string, on: string): Promise<void>;
  daily(userId: string, on: string): Promise<Daily>;
  weekly(userId: string, on: string): Promise<Weekly>;
  staleReviews(): Promise<ReviewPing[]>;
  markReviewPinged(ids: string[]): Promise<void>;
  sleepingQueues(): Promise<SleepingQueue[]>;
  markQueueWarned(userIds: string[]): Promise<void>;
  purgeUpdates(): Promise<void>;
}

const GONE = /bot was blocked|user is deactivated|chat not found/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runNotify(d: { db: NotifyDb; tg: Tg; miniappUrl?: string }) {
  let reminders = 0, digests = 0, pings = 0, queues = 0;
  const mark: string[] = [];
  for (const r of await d.db.dueReminders()) {
    try {
      await d.tg.sendMessage(r.chat_id, renderReminder(r));
      mark.push(r.item_id);
      reminders++;
    } catch (e) {
      if (GONE.test(errText(e))) mark.push(r.item_id);
      else console.error("reminder failed:", errText(e));
    }
  }
  if (mark.length) {
    try {
      await d.db.markReminded(mark);
    } catch (e) {
      console.error("mark reminded failed:", errText(e));
    }
  }

  const buttons: Button[][] | undefined = d.miniappUrl
    ? [[{ text: "📱 Открыть планер", web_app: { url: d.miniappUrl } }]]
    : undefined;
  for (const g of await d.db.dueDigests()) {
    try {
      // #15: сводка считается за день из due_digests, а не «за сегодня» — иначе
      // догон после простоя присылает пустые итоги за новый день
      const text = g.kind === "daily"
        ? renderDaily(await d.db.daily(g.user_id, g.local_date))
        : renderWeekly(await d.db.weekly(g.user_id, g.local_date));
      try {
        await d.tg.sendMessage(g.chat_id, text, buttons);
        digests++;
      } catch (e) {
        if (!GONE.test(errText(e))) throw e;
      }
      await d.db.markDigest(g.user_id, g.kind, g.local_date);
    } catch (e) {
      console.error("digest failed:", g.kind, errText(e));
    }
  }

  // #8: переспросить незакрытые уточнения, иначе записи теряются навсегда
  const pinged: string[] = [];
  for (const p of await d.db.staleReviews()) {
    try {
      await d.tg.sendMessage(p.chat_id, renderReviewPing(p), [
        [{ text: "🚫 Убрать запись", callback_data: `cxl:${p.inbox_id}` }],
      ]);
      pinged.push(p.inbox_id);
      pings++;
    } catch (e) {
      if (GONE.test(errText(e))) pinged.push(p.inbox_id);
      else console.error("review ping failed:", errText(e));
    }
  }
  if (pinged.length) {
    try {
      await d.db.markReviewPinged(pinged);
    } catch (e) {
      console.error("mark review pinged failed:", errText(e));
    }
  }

  // #10: сказать, что ИИ спит и сколько накопилось — один раз в 12 часов
  const warned: string[] = [];
  for (const q of await d.db.sleepingQueues()) {
    try {
      await d.tg.sendMessage(q.chat_id, renderSleeping(q));
      warned.push(q.user_id);
      queues++;
    } catch (e) {
      if (GONE.test(errText(e))) warned.push(q.user_id);
      else console.error("queue notice failed:", errText(e));
    }
  }
  if (warned.length) {
    try {
      await d.db.markQueueWarned(warned);
    } catch (e) {
      console.error("mark queue warned failed:", errText(e));
    }
  }

  // чистим журнал обработанных апдейтов (#13) — notify уже ходит раз в минуту
  try {
    await d.db.purgeUpdates();
  } catch (e) {
    console.error("purge updates failed:", errText(e));
  }

  return { reminders, digests, pings, queues };
}
