import type { Db, User } from "./db.ts";
import type { Button, Tg } from "../_shared/telegram.ts";

import type { MenuDb } from "./menu_db.ts";
import { MENU_ROWS, menuKey } from "./keyboard.ts";
import { handleMenuButton, handleMenuCallback, handlePendingInput } from "./menu.ts";

export type Deps = { db: Db; tg: Tg; adminTgId: number; menu: MenuDb; supabaseUrl: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENU_HINT = "Меню — внизу 👇";

import { CURRENCIES } from "./currencies.ts";

export { CURRENCIES };

export const KIND_LABELS: Record<string, string> = {
  task: "☑️ Задача",
  event: "📅 Встреча",
  expense: "💸 Расход",
  income: "💰 Доход",
  note: "💡 Мысль",
  journal: "📔 Дневник",
  habit_done: "🔁 Привычка",
  habit_new: "➕ Новая привычка",
};

const NO_ACCESS = "Доступ по приглашению. Попроси владельца добавить тебя.";

const currencyButtons = (): Button[][] => [
  CURRENCIES.map((c) => ({ text: c, callback_data: `cur:${c}` })),
  [{ text: "Другая", callback_data: "cur:other" }],
];

const onboardedText = (code: string) =>
  `Готово! Базовая валюта — ${code}.\n\n` +
  "Теперь просто пиши или наговаривай голосовым всё подряд: " +
  "«завтра в 15 встреча с Андреем, потратил 30 000 на такси, не забыть оплатить интернет» — я сам разложу по разделам.";

// deno-lint-ignore no-explicit-any
export async function handleUpdate(update: any, d: Deps): Promise<void> {
  if (update.message) return await handleMessage(update.message, d);
  if (update.callback_query) return await handleCallback(update.callback_query, d);
}

// deno-lint-ignore no-explicit-any
async function handleMessage(msg: any, d: Deps) {
  if (msg.chat?.type !== "private" || !msg.from) return;
  const chatId: number = msg.chat.id;
  const username: string | null = msg.from.username ? String(msg.from.username).toLowerCase() : null;

  let user = await d.db.findUser(msg.from.id);
  if (!user) {
    const isAdmin = msg.from.id === d.adminTgId;
    const allowed = isAdmin || (username !== null && await d.db.isInvited(username));
    if (!allowed) {
      await d.tg.sendMessage(chatId, NO_ACCESS);
      return;
    }
    user = await d.db.createUser({
      tg_id: msg.from.id,
      tg_username: username,
      name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
      is_allowed: true,
      is_admin: isAdmin,
    });
  }
  if (!user.is_allowed) {
    await d.tg.sendMessage(chatId, NO_ACCESS);
    return;
  }

  const text: string | undefined = msg.text;
  if (text && /^\/(allow|deny)\b/.test(text)) return await handleAdmin(user, chatId, text, d);

  if (!user.onboarded_at) {
    const code = text?.trim().toUpperCase();
    if (code && /^[A-Z]{3}$/.test(code)) {
      if (await d.db.knownCurrency(code)) {
        await d.db.onboard(user.id, code);
        await d.tg.sendMessage(chatId, onboardedText(code), undefined, { replyKeyboard: MENU_ROWS });
      } else {
        await d.tg.sendMessage(
          chatId,
          `Не знаю валюту ${code}. Выбери из списка или пришли трёхбуквенный код (например, GBP).`,
          currencyButtons(),
        );
      }
      return;
    }
    await d.tg.sendMessage(
      chatId,
      "Привет! Выбери базовую валюту — в ней будут все итоги и лимиты. Потом её не поменять.",
      currencyButtons(),
    );
    return;
  }

  if ((text === "/start" || text === "/menu") && user.pending_action) await d.menu.setPending(user.id, null);
  if (text === "/start") {
    await d.tg.sendMessage(chatId, onboardedText(user.base_currency!), undefined, { replyKeyboard: MENU_ROWS });
    return;
  }
  if (text === "/menu") {
    await d.tg.sendMessage(chatId, MENU_HINT, undefined, { replyKeyboard: MENU_ROWS });
    return;
  }
  const key = menuKey(text);
  if (key) return await handleMenuButton(user, chatId, key, d);
  if (text && !text.startsWith("/") && await handlePendingInput(user, chatId, text, d)) return;

  let payload: { source: "text" | "voice"; text?: string; audio_ref?: string };
  if (msg.voice) payload = { source: "voice", audio_ref: msg.voice.file_id };
  else if (text && !text.startsWith("/")) payload = { source: "text", text };
  else {
    await d.tg.sendMessage(chatId, "Пришли текст или голосовое.");
    return;
  }

  const online = await d.db.workerOnline();
  const ack = await d.tg.sendMessage(chatId, online ? "⏳ Разбираю…" : "⏳ Принял, разберу, когда ИИ проснётся.");
  await d.db.createInbox({
    user_id: user.id,
    ...payload,
    reply_chat_id: chatId,
    reply_message_id: ack.message_id,
  });
}

async function handleAdmin(user: User, chatId: number, text: string, d: Deps) {
  if (!user.is_admin) {
    await d.tg.sendMessage(chatId, "Команда только для владельца.");
    return;
  }
  const [cmd, arg] = text.trim().split(/\s+/);
  const username = arg?.replace(/^@/, "").toLowerCase();
  if (!username) {
    await d.tg.sendMessage(chatId, "Формат: /allow @username или /deny @username");
    return;
  }
  if (cmd === "/allow") {
    await d.db.invite(username);
    await d.tg.sendMessage(chatId, `✅ @${username} может пользоваться ботом.`);
  } else {
    await d.db.revoke(username);
    await d.tg.sendMessage(chatId, `⛔️ Доступ @${username} закрыт.`);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCallback(cq: any, d: Deps) {
  const chatId: number | undefined = cq.message?.chat?.id;
  const messageId: number | undefined = cq.message?.message_id;
  const user = await d.db.findUser(cq.from.id);
  if (!user || !user.is_allowed || chatId === undefined || messageId === undefined) {
    await d.tg.answerCallback(cq.id, "Нет доступа");
    return;
  }
  const [action, ...rest] = String(cq.data ?? "").split(":");

  if (action === "cur") {
    const code = rest[0];
    if (user.onboarded_at) {
      await d.tg.answerCallback(cq.id, "Валюта уже выбрана");
      return;
    }
    await d.tg.answerCallback(cq.id);
    if (code === "other") {
      await d.tg.sendMessage(chatId, "Пришли трёхбуквенный код валюты, например GBP.");
      return;
    }
    if (!CURRENCIES.includes(code)) return;
    await d.db.onboard(user.id, code);
    await d.tg.editMessage(chatId, messageId, onboardedText(code));
    await d.tg.sendMessage(chatId, MENU_HINT, undefined, { replyKeyboard: MENU_ROWS });
    return;
  }

  if (action === "del") {
    const n = await d.db.deleteRecords(user.id, rest[0]);
    await d.tg.answerCallback(cq.id);
    await d.tg.editMessage(chatId, messageId, n > 0 ? "🗑 Удалено." : "Нечего удалять.");
    return;
  }

  if (action === "rv") {
    const [inboxId, idxStr, choice] = rest;
    if (choice !== "drop" && !Object.hasOwn(KIND_LABELS, choice)) {
      await d.tg.answerCallback(cq.id);
      return;
    }
    const ok = await d.db.resolveReview(user.id, inboxId, Number(idxStr), choice);
    if (!ok) {
      await d.tg.answerCallback(cq.id, "Уже обработано или идёт разбор — попробуй через пару секунд");
      return;
    }
    await d.tg.answerCallback(cq.id);
    await d.tg.editMessage(chatId, messageId, choice === "drop" ? "🗑 Пропущено." : `Принял: ${KIND_LABELS[choice]}`);
    return;
  }

  if (action === "rt") {
    const [inboxId = "", idxStr, choice = ""] = rest;
    if (!UUID_RE.test(inboxId) || !/^(([01]\d|2[0-3])[0-5]\d|none|drop)$/.test(choice)) {
      await d.tg.answerCallback(cq.id);
      return;
    }
    const ok = await d.db.resolveTime(user.id, inboxId, Number(idxStr), choice);
    if (!ok) {
      await d.tg.answerCallback(cq.id, "Уже обработано или идёт разбор — попробуй через пару секунд");
      return;
    }
    await d.tg.answerCallback(cq.id);
    const label = choice === "drop"
      ? "🗑 Пропущено."
      : choice === "none"
      ? "Принял: ☑️ без времени"
      : `Принял: 📅 ${choice.slice(0, 2)}:${choice.slice(2)}`;
    await d.tg.editMessage(chatId, messageId, label);
    return;
  }

  if (await handleMenuCallback(user, cq, action, rest, d)) return;
  await d.tg.answerCallback(cq.id);
}
