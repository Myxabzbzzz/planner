import type { Button, Tg } from "../_shared/telegram.ts";
import { type Daily, type DueDigest, type Reminder, renderDaily, renderReminder, renderWeekly, type Weekly } from "./render.ts";

export interface NotifyDb {
  dueReminders(): Promise<Reminder[]>;
  markReminded(ids: string[]): Promise<void>;
  dueDigests(): Promise<DueDigest[]>;
  markDigest(userId: string, kind: string, on: string): Promise<void>;
  daily(userId: string): Promise<Daily>;
  weekly(userId: string): Promise<Weekly>;
}

const GONE = /bot was blocked|user is deactivated|chat not found/i;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runNotify(d: { db: NotifyDb; tg: Tg; miniappUrl?: string }) {
  let reminders = 0, digests = 0;
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
  if (mark.length) await d.db.markReminded(mark);

  const buttons: Button[][] | undefined = d.miniappUrl
    ? [[{ text: "📱 Открыть планер", web_app: { url: d.miniappUrl } }]]
    : undefined;
  for (const g of await d.db.dueDigests()) {
    try {
      let text: string, on: string;
      if (g.kind === "daily") {
        const daily = await d.db.daily(g.user_id);
        text = renderDaily(daily);
        on = daily.date;
      } else {
        const weekly = await d.db.weekly(g.user_id);
        text = renderWeekly(weekly);
        on = weekly.to;
      }
      try {
        await d.tg.sendMessage(g.chat_id, text, buttons);
        digests++;
      } catch (e) {
        if (!GONE.test(errText(e))) throw e;
      }
      await d.db.markDigest(g.user_id, g.kind, on);
    } catch (e) {
      console.error("digest failed:", g.kind, errText(e));
    }
  }
  return { reminders, digests };
}
