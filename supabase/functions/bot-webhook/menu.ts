import type { Tg } from "../_shared/telegram.ts";
import type { User } from "./db.ts";
import type { MenuDb } from "./menu_db.ts";
import { type MenuKey, TZ_OPTIONS } from "./keyboard.ts";
import {
  fmtAmount, renderHabits, renderMoney, renderSettings, renderTapGuide, renderTasks, renderToday, shortcutAck, tzChoice, type View,
} from "./views.ts";

export type MenuDeps = { menu: MenuDb; tg: Tg; supabaseUrl: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE = "Уже неактуально";

const show = (d: MenuDeps, chatId: number, v: View) => d.tg.sendMessage(chatId, v.text, v.buttons);

export function parseAmount(text: string): number | null {
  const m = text.trim().toLowerCase().replace(/\s+/g, " ")
    .match(/^(\d[\d .,]*?)\s*(к|k|тыс\.?|тысяч[аи]?|млн|миллион(?:а|ов)?)?$/);
  if (!m) return null;
  let num = m[1].replace(/ /g, "");
  if (num.includes(",")) num = num.replace(/\./g, "").replace(",", ".");
  else if ((num.match(/\./g) ?? []).length > 1) num = num.replace(/\./g, "");
  const n = Number(num);
  if (!Number.isFinite(n) || n >= 1e15) return null;
  const mult = !m[2] ? 1 : /^(к|k|тыс)/.test(m[2]) ? 1000 : 1_000_000;
  return Math.round(n * mult * 100) / 100;
}

export async function handleMenuButton(user: User, chatId: number, key: MenuKey, d: MenuDeps): Promise<void> {
  if (user.pending_action) await d.menu.setPending(user.id, null);
  if (key === "app") {
    await d.tg.sendMessage(chatId, "📱 Приложение появится скоро — пока всё доступно кнопками и голосом.");
    return;
  }
  const views: Record<Exclude<MenuKey, "app">, () => Promise<View>> = {
    today: async () => renderToday(await d.menu.today(user.id)),
    tasks: async () => renderTasks(await d.menu.tasks(user.id)),
    money: async () => renderMoney(await d.menu.money(user.id)),
    habits: async () => renderHabits(await d.menu.habits(user.id)),
    settings: async () => renderSettings(await d.menu.settings(user.id)),
  };
  await show(d, chatId, await views[key]());
}

export async function handlePendingInput(user: User, chatId: number, text: string, d: MenuDeps): Promise<boolean> {
  if (user.pending_action !== "limit") return false;
  const amount = parseAmount(text);
  if (amount === null) {
    await d.menu.setPending(user.id, null);
    await d.tg.sendMessage(chatId, "Лимит не изменил.");
    return false;
  }
  await d.menu.setLimit(user.id, amount);
  await d.menu.setPending(user.id, null);
  await d.tg.sendMessage(
    chatId,
    amount === 0 ? "✅ Лимит убран." : `✅ Лимит на месяц: ${fmtAmount(amount, user.base_currency!)}`,
  );
  return true;
}

// deno-lint-ignore no-explicit-any
export async function handleMenuCallback(user: User, cq: any, action: string, rest: string[], d: MenuDeps): Promise<boolean> {
  if (!user.onboarded_at) {
    await d.tg.answerCallback(cq.id, "Нет доступа");
    return true;
  }
  const chatId: number = cq.message.chat.id;
  const messageId: number = cq.message.message_id;
  const stale = () => d.tg.answerCallback(cq.id, STALE);
  const edit = async (v: View, html = false) => {
    try {
      await d.tg.editMessage(chatId, messageId, v.text, v.buttons, html ? { html: true } : undefined);
    } catch (e) {
      if (!(e instanceof Error && e.message.includes("message is not modified"))) throw e;
    }
  };

  switch (action) {
    case "done": {
      const id = rest[0] ?? "";
      if (!UUID.test(id) || !(await d.menu.completeTask(user.id, id))) {
        await stale();
        return true;
      }
      await d.tg.answerCallback(cq.id, "Готово ✅");
      await edit(renderTasks(await d.menu.tasks(user.id)));
      return true;
    }
    case "hab": {
      const [id = "", where] = rest;
      if (!UUID.test(id) || !(await d.menu.logHabit(user.id, id))) {
        await stale();
        return true;
      }
      await d.tg.answerCallback(cq.id, "Отмечено ✔️");
      await edit(where === "h" ? renderHabits(await d.menu.habits(user.id)) : renderToday(await d.menu.today(user.id)));
      return true;
    }
    case "set": {
      await d.tg.answerCallback(cq.id);
      if (rest[0] === "tz") await edit(tzChoice());
      else if (rest[0] === "limit") {
        await d.menu.setPending(user.id, "limit");
        await d.tg.sendMessage(chatId, `Пришли сумму в ${user.base_currency} на месяц. 0 — убрать лимит.`);
      } else if (rest[0] === "tap") {
        await d.menu.requestShortcut(user.id, chatId);
        const v = shortcutAck(await d.menu.workerOnline());
        await d.tg.sendMessage(chatId, v.text, v.buttons);
      }
      return true;
    }
    case "tz": {
      const opt = TZ_OPTIONS.find((o) => o.key === rest[0]);
      if (!opt || !(await d.menu.setTz(user.id, opt.tz))) {
        await stale();
        return true;
      }
      await d.tg.answerCallback(cq.id, `Часовой пояс: ${opt.label}`);
      await edit(renderSettings(await d.menu.settings(user.id)));
      return true;
    }
    case "tap": {
      if (rest[0] === "new") {
        await d.menu.rotateToken(user.id);
        await d.menu.requestShortcut(user.id, chatId);
        await d.tg.answerCallback(cq.id, "Новый токен готов");
        const v = shortcutAck(await d.menu.workerOnline());
        await edit(v);
        return true;
      }
      if (rest[0] === "manual") {
        await d.tg.answerCallback(cq.id);
        const s = await d.menu.settings(user.id);
        const v = renderTapGuide(d.supabaseUrl, s.capture_token);
        await d.tg.sendMessage(chatId, v.text, v.buttons, { html: true });
        return true;
      }
      await stale();
      return true;
    }
  }
  return false;
}
