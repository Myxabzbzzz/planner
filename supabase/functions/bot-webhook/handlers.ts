import type { Db, User } from "./db.ts";
import type { Button, Tg } from "../_shared/telegram.ts";
import { MAX_VOICE_SEC, TOO_LONG_VOICE, TOO_MANY } from "../_shared/limits.ts";

import type { MenuDb } from "./menu_db.ts";
import { MENU_ROWS, menuKey } from "./keyboard.ts";
import { handleMenuButton, handleMenuCallback, handlePendingInput } from "./menu.ts";

export type Deps = {
  db: Db;
  tg: Tg;
  adminTgId: number;
  menu: MenuDb;
  supabaseUrl: string;
  miniappUrl?: string;
  openAccess?: boolean; // любой, кто нажал /start, получает доступ (кроме закрытых через /deny)
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MENU_HINT = "Меню — внизу 👇";
const MAX_TEXT = 4000;

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
const ASK_ACCESS: Button[][] = [[{ text: "✋ Запросить доступ", callback_data: "ask" }]];
const PRIVACY = [
  "🔒 Конфиденциальность",
  "",
  "Что храню: твой Telegram id, имя и ник; тексты сообщений и то, что из них разобрано, — дела, встречи, траты, заметки, привычки.",
  "Голосовые после распознавания удаляются — хранится только текст.",
  "Где: база в облаке Supabase; разбирает сообщения ИИ-модель на компьютере владельца бота. Сторонним ИИ-сервисам и рекламе данные не передаются.",
  "Удалённые записи стираются насовсем через 30 дней. В мини-приложении (Профиль → Аккаунт) можно выгрузить все данные или удалить аккаунт целиком.",
].join("\n");
const privacyText = (miniappUrl?: string) =>
  miniappUrl ? `${PRIVACY}\n\nПолностью: ${new URL("privacy.html", miniappUrl).href}` : PRIVACY;

const SAVE_FAILED = "😵 Не смог принять запись — база не ответила. Пришли её, пожалуйста, ещё раз.";

const currencyButtons = (): Button[][] => [
  CURRENCIES.map((c) => ({ text: c, callback_data: `cur:${c}` })),
  [{ text: "Другая", callback_data: "cur:other" }],
];

const onboardedText = (code: string) =>
  `Готово! Базовая валюта — ${code}.\n\n` +
  "Теперь просто пиши или наговаривай голосовым всё подряд: " +
  "«завтра в 15 встреча с Андреем, потратил 30 000 на такси, не забыть оплатить интернет» — я сам разложу по разделам.";

const uname = (from: { username?: unknown }): string | null =>
  from.username ? String(from.username).toLowerCase() : null;

// deno-lint-ignore no-explicit-any
export async function handleUpdate(update: any, d: Deps): Promise<void> {
  // #13: Telegram повторяет апдейт при таймауте вебхука — второй раз обрабатывать нельзя,
  // иначе пользователь получает два «Разбираю…» и трату записывает дважды.
  if (!(await d.db.recordUpdate(update?.update_id))) return;
  if (update.message) return await handleMessage(update.message, d);
  if (update.callback_query) return await handleCallback(update.callback_query, d);
}

// deno-lint-ignore no-explicit-any
async function handleMessage(msg: any, d: Deps) {
  if (msg.chat?.type !== "private" || !msg.from) return;
  const chatId: number = msg.chat.id;
  const username = uname(msg.from);
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ");

  let user = await d.db.findUser(msg.from.id);
  if (!user) {
    const isAdmin = msg.from.id === d.adminTgId;
    const allowed = isAdmin || d.openAccess === true || await d.db.claimInvite(msg.from.id, username);
    if (!allowed) {
      await d.tg.sendMessage(chatId, NO_ACCESS, d.adminTgId ? ASK_ACCESS : undefined);
      return;
    }
    user = await d.db.createUser({
      tg_id: msg.from.id,
      tg_username: username,
      name,
      is_allowed: true,
      is_admin: isAdmin,
    });
  } else {
    // #7: ник меняется, а в базе лежал старый — тогда /deny @ник не срабатывал
    await d.db.touchUser(msg.from.id, username, name);
  }
  if (!user.is_allowed) {
    await d.tg.sendMessage(chatId, NO_ACCESS, d.adminTgId ? ASK_ACCESS : undefined);
    return;
  }

  const text: string | undefined = msg.text;
  if (text && /^\/(allow|deny)\b/.test(text)) return await handleAdmin(user, chatId, text, d);
  if (text === "/privacy") {
    await d.tg.sendMessage(chatId, privacyText(d.miniappUrl));
    return;
  }

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
      "Привет! Выбери базовую валюту — в ней будут все итоги и лимиты. Менять её потом непросто.\n\n" +
        "Как я храню твои данные — /privacy",
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
  // #38: в inbox из чата текст уходил без ограничения длины, в отличие от capture и api
  else if (text && !text.startsWith("/")) payload = { source: "text", text: text.slice(0, MAX_TEXT) };
  else {
    await d.tg.sendMessage(chatId, "Пришли текст или голосовое.");
    return;
  }

  if (msg.voice && Number(msg.voice.duration) > MAX_VOICE_SEC) {
    await d.tg.sendMessage(chatId, TOO_LONG_VOICE);
    return;
  }
  // очередь на ноутбуке одна на всех: без лимита один человек задержит разбор у остальных
  if (!await d.db.rateLimit(user.id, payload.source === "voice" ? "audio" : "inbox")) {
    await d.tg.sendMessage(chatId, TOO_MANY);
    return;
  }

  // #12: ack уходил ДО вставки в inbox, и при сбое базы пользователь навсегда
  // оставался с «⏳ Разбираю…» без записи и без ошибки. Теперь сначала запись.
  let inboxId: string;
  try {
    inboxId = await d.db.createInbox({ user_id: user.id, ...payload, reply_chat_id: chatId });
  } catch (e) {
    console.error("createInbox failed", e);
    await d.tg.sendMessage(chatId, SAVE_FAILED);
    return;
  }
  const online = await d.db.workerOnline().catch(() => true);
  const ack = await d.tg.sendMessage(
    chatId,
    online ? "⏳ Разбираю…" : await offlineAck(user.id, d),
    [[{ text: "🚫 Отменить", callback_data: `cxl:${inboxId}` }]],
  );
  // привязываем ack к записи отдельным шагом: если он не долетел, запись всё равно есть
  await d.db.setInboxReply(inboxId, ack.message_id).catch((e) => console.error("setInboxReply failed", e));
}

async function handleAdmin(user: User, chatId: number, text: string, d: Deps) {
  if (!user.is_admin) {
    await d.tg.sendMessage(chatId, "Команда только для владельца.");
    return;
  }
  const [cmd, arg] = text.trim().split(/\s+/);
  if (!arg) {
    await d.tg.sendMessage(chatId, "Формат: /allow @username или /allow 123456789 (Telegram id)");
    return;
  }
  // #7: id надёжнее ника — ник переиспользуется, id нет
  const asId = /^\d{5,}$/.test(arg) ? Number(arg) : undefined;
  const username = asId ? null : arg.replace(/^@/, "").toLowerCase();
  const who = asId ? `id ${asId}` : `@${username}`;
  if (cmd === "/allow") {
    await d.db.invite(username, asId);
    await d.tg.sendMessage(
      chatId,
      username
        ? `✅ @${username} может зайти — приглашение на один вход и на 7 дней.`
        : `✅ ${who} может пользоваться ботом.`,
    );
  } else {
    const n = await d.db.revoke(username, asId);
    await d.tg.sendMessage(chatId, n > 0 ? `⛔️ Доступ ${who} закрыт.` : `${who} и так без доступа.`);
  }
}

// deno-lint-ignore no-explicit-any
async function handleCallback(cq: any, d: Deps) {
  const chatId: number | undefined = cq.message?.chat?.id;
  const messageId: number | undefined = cq.message?.message_id;
  const user = await d.db.findUser(cq.from.id);

  // #26: человек без доступа упирался в тупик, а владелец об этом не узнавал
  if (cq.data === "ask") {
    await d.tg.answerCallback(cq.id, "Отправил владельцу");
    if (!d.adminTgId) return;
    const who = uname(cq.from);
    const title = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(" ") || "Без имени";
    await d.tg.sendMessage(
      d.adminTgId,
      `✋ Просит доступ: ${title}${who ? ` (@${who})` : ""}, id ${cq.from.id}`,
      [[{ text: "✅ Разрешить", callback_data: `inv:${cq.from.id}` }]],
    );
    if (chatId !== undefined) {
      await d.tg.sendMessage(chatId, "Передал владельцу — напишу, как только он откроет доступ.");
    }
    return;
  }

  if (!user || !user.is_allowed || chatId === undefined || messageId === undefined) {
    await d.tg.answerCallback(cq.id, "Нет доступа");
    return;
  }
  const [action, ...rest] = String(cq.data ?? "").split(":");

  if (action === "inv") {
    if (!user.is_admin) {
      await d.tg.answerCallback(cq.id, "Только для владельца");
      return;
    }
    // id пришёл из нашей же кнопки, так что хватает проверки «это цифры»
    const tgId = /^\d{1,18}$/.test(rest[0] ?? "") ? Number(rest[0]) : null;
    if (tgId === null) {
      await d.tg.answerCallback(cq.id);
      return;
    }
    await d.db.invite(null, tgId);
    await d.tg.answerCallback(cq.id, "Доступ открыт");
    await d.tg.editMessage(chatId, messageId, `✅ Доступ открыт: id ${tgId}`);
    await d.tg.sendMessage(tgId, "✅ Доступ открыт! Нажми /start — и можно наговаривать всё подряд.")
      .catch(() => {});
    return;
  }

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
    // #38: невалидный UUID ронял хендлер, и кнопка крутилась до таймаута
    if (!UUID_RE.test(rest[0] ?? "")) {
      await d.tg.answerCallback(cq.id, "Уже неактуально");
      return;
    }
    const n = await d.db.deleteRecords(user.id, rest[0]);
    await d.tg.answerCallback(cq.id);
    // Кнопка «Удалить всё» сносит сразу все записи одного сообщения и висит
    // под каждой старой сводкой — поэтому к ней нужен путь назад.
    await d.tg.editMessage(
      chatId,
      messageId,
      n > 0 ? `🗑 Удалено записей: ${n}.` : "Нечего удалять.",
      n > 0 ? [[{ text: "↩️ Вернуть", callback_data: `undel:${rest[0]}` }]] : undefined,
    );
    return;
  }

  if (action === "undel") {
    if (!UUID_RE.test(rest[0] ?? "")) {
      await d.tg.answerCallback(cq.id, "Уже неактуально");
      return;
    }
    const n = await d.db.restoreRecords(user.id, rest[0]);
    await d.tg.answerCallback(cq.id, n > 0 ? "Вернул" : "Возвращать нечего");
    await d.tg.editMessage(chatId, messageId, n > 0 ? `↩️ Вернул записей: ${n}.` : "Возвращать уже нечего.");
    return;
  }

  // #11: «не получилось разобрать» перестало быть тупиком
  if (action === "rtx") {
    if (!UUID_RE.test(rest[0] ?? "")) {
      await d.tg.answerCallback(cq.id, "Уже неактуально");
      return;
    }
    if (!(await d.db.retryInbox(user.id, rest[0]))) {
      await d.tg.answerCallback(cq.id, "Эта запись уже не в ошибке");
      return;
    }
    await d.tg.answerCallback(cq.id, "Пробую снова");
    const online = await d.db.workerOnline().catch(() => true);
    await d.tg.editMessage(chatId, messageId, online ? "⏳ Пробую разобрать снова…" : "⏳ Разберу, когда ИИ проснётся.");
    return;
  }

  // #10: отправленное можно отменить — и из ack, и из зависшего уточнения
  if (action === "cxl") {
    if (!UUID_RE.test(rest[0] ?? "")) {
      await d.tg.answerCallback(cq.id, "Уже неактуально");
      return;
    }
    if (!(await d.db.cancelInbox(user.id, rest[0]))) {
      await d.tg.answerCallback(cq.id, "Уже разобрано — отменять нечего");
      return;
    }
    await d.tg.answerCallback(cq.id, "Убрал");
    await d.tg.editMessage(chatId, messageId, "🚫 Запись убрана, разбирать не буду.");
    return;
  }

  if (action === "rv") {
    const [inboxId = "", idxStr, choice = ""] = rest;
    if (!UUID_RE.test(inboxId) || (choice !== "drop" && !Object.hasOwn(KIND_LABELS, choice))) {
      await d.tg.answerCallback(cq.id);
      return;
    }
    const ok = await d.db.resolveReview(user.id, inboxId, Number(idxStr), choice);
    if (!ok) {
      await d.tg.answerCallback(cq.id, "Уже обработано или идёт разбор — попробуй через пару секунд");
      return;
    }
    await d.tg.answerCallback(cq.id);
    await d.tg.editMessage(chatId, messageId, await resolvedText(choice === "drop" ? null : KIND_LABELS[choice], d));
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
      ? null
      : choice === "none"
      ? "☑️ без времени"
      : `📅 ${choice.slice(0, 2)}:${choice.slice(2)}`;
    await d.tg.editMessage(chatId, messageId, await resolvedText(label, d));
    return;
  }

  if (await handleMenuCallback(user, cq, action, rest, d)) return;
  await d.tg.answerCallback(cq.id);
}

// #10: пока ИИ спит, очередь была невидимой — человек не знал, сколько уже накопилось
async function offlineAck(userId: string, d: Deps): Promise<string> {
  const base = "⏳ Принял, разберу, когда ИИ проснётся.";
  try {
    const q = await d.db.queue(userId);
    return q.waiting > 1 ? `${base}\nВ очереди уже ${q.waiting} — ничего не потеряется.` : base;
  } catch (e) {
    console.error("queue lookup failed", e);
    return base;
  }
}

// #5: «Принял: 📅 Встреча» звучало как «записано», хотя resolve_review только ставит
// status='pending' — запись создаёт воркер. Пока он не ответил, честно пишем «записываю».
async function resolvedText(label: string | null, d: Deps): Promise<string> {
  if (label === null) return "🗑 Пропущено.";
  const online = await d.db.workerOnline().catch(() => true);
  return online ? `Принял: ${label} — записываю…` : `Принял: ${label} — запишу, когда ИИ проснётся.`;
}
