import type { Button } from "../_shared/telegram.ts";
import { TZ_OPTIONS } from "./keyboard.ts";
import type { HabitsSummary, MoneySummary, SettingsSummary, TasksSummary, TodaySummary } from "./menu_db.ts";

export type View = { text: string; buttons?: Button[][] };

const SYMBOLS: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€", UZS: "сум", KZT: "₸" };

export function fmtNumber(n: number): string {
  const [int, frac] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === "00" ? grouped : `${grouped},${frac}`;
}

export const fmtAmount = (n: number, cur: string) => `${fmtNumber(n)} ${SYMBOLS[cur] ?? cur}`;

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function renderToday(s: TodaySummary): View {
  const blocks = ["📅 Сегодня"];
  if (!s.events.length && !s.tasks.length) blocks.push("Сегодня ничего не запланировано.");
  if (s.events.length) blocks.push(["Встречи:", ...s.events.map((e) => `• ${e.time} ${e.title}`)].join("\n"));
  if (s.tasks.length) {
    const lines = s.tasks.map((t) => (t.overdue ? `• ⚠️ ${t.title} (просрочено)` : `• ${t.title}`));
    if (s.tasks_more > 0) lines.push(`• …и ещё ${s.tasks_more}`);
    blocks.push(["Задачи:", ...lines].join("\n"));
  }
  let money = `💸 Потрачено сегодня: ${fmtAmount(s.spent_today, s.base_currency)}`;
  if (s.limit !== null) {
    const left = s.limit - s.month_spent;
    money += left >= 0
      ? `\nЛимит на месяц: осталось ${fmtAmount(left, s.base_currency)} из ${fmtAmount(s.limit, s.base_currency)}`
      : `\nЛимит на месяц превышен на ${fmtAmount(-left, s.base_currency)}`;
  }
  blocks.push(money);
  if (s.habits.length) {
    blocks.push("🔁 Привычки: " + s.habits.map((h) => `${h.done ? "✅" : "▫️"} ${h.name}`).join(" · "));
  }
  const todo = s.habits.filter((h) => !h.done).map((h) => ({ text: `✔️ ${h.name}`, callback_data: `hab:${h.id}:t` }));
  return { text: blocks.join("\n\n"), buttons: todo.length ? chunk(todo, 2) : undefined };
}

export function renderTasks(s: TasksSummary): View {
  if (!s.tasks.length) return { text: "☑️ Задачи\n\nОткрытых задач нет 🎉" };
  const lines = s.tasks.map((t, i) =>
    `${i + 1}. ${t.overdue ? "⚠️ " : ""}${t.title}${t.due ? ` — до ${t.due}` : ""}`
  );
  const buttons = s.tasks.map((t, i) => ({ text: `✅ ${i + 1}`, callback_data: `done:${t.id}` }));
  if (s.total > s.tasks.length) lines.push(`…и ещё ${s.total - s.tasks.length}`);
  return { text: `☑️ Задачи (${s.total})\n\n${lines.join("\n")}`, buttons: chunk(buttons, 5) };
}

export function renderMoney(s: MoneySummary): View {
  const head = `💸 Деньги за ${s.month}`;
  if (s.expense === 0 && s.income === 0) return { text: `${head}\n\nВ этом месяце трат нет.` };
  let totals = `Расходы: ${fmtAmount(s.expense, s.base_currency)}\nДоходы: ${fmtAmount(s.income, s.base_currency)}`;
  if (s.limit !== null) {
    const left = s.limit - s.expense;
    totals += left >= 0
      ? `\nЛимит: ${fmtAmount(s.limit, s.base_currency)}, осталось ${fmtAmount(left, s.base_currency)}`
      : `\nЛимит: ${fmtAmount(s.limit, s.base_currency)}, превышен на ${fmtAmount(-left, s.base_currency)}`;
  }
  const blocks = [head, totals];
  if (s.by_category.length) {
    blocks.push(["По категориям:", ...s.by_category.map((c) => `• ${c.name} — ${fmtAmount(c.amount, s.base_currency)}`)].join("\n"));
  }
  return { text: blocks.join("\n\n") };
}

export function renderHabits(s: HabitsSummary): View {
  if (!s.habits.length) return { text: "🔁 Привычки\n\nПривычек пока нет. Скажи «хочу трекать зарядку»." };
  const lines = s.habits.map((h) => `${h.name} — ${h.week.map((d) => (d ? "✅" : "▫️")).join("")} · серия ${h.streak}`);
  const todo = s.habits.filter((h) => !h.done_today).map((h) => ({ text: `✔️ ${h.name}`, callback_data: `hab:${h.id}:h` }));
  return { text: `🔁 Привычки\n\n${lines.join("\n")}`, buttons: todo.length ? chunk(todo, 2) : undefined };
}

export function renderSettings(s: SettingsSummary): View {
  const opt = TZ_OPTIONS.find((o) => o.tz === s.tz);
  const tz = opt ? `${opt.label} (${s.tz})` : s.tz;
  const limit = s.limit === null ? "не задан" : fmtAmount(s.limit, s.base_currency);
  return {
    text: `⚙️ Настройки\n\n🕐 Часовой пояс: ${tz}\n💱 Базовая валюта: ${s.base_currency}\n💰 Лимит на месяц: ${limit}`,
    buttons: [
      [{ text: "🕐 Часовой пояс", callback_data: "set:tz" }],
      [{ text: "💰 Лимит на месяц", callback_data: "set:limit" }],
      [{ text: "📲 Двойной тап", callback_data: "set:tap" }],
    ],
  };
}

export function tzChoice(): View {
  return {
    text: "Выбери часовой пояс:",
    buttons: chunk(TZ_OPTIONS.map((o) => ({ text: o.label, callback_data: `tz:${o.key}` })), 2),
  };
}

export function renderTapGuide(supabaseUrl: string, token: string): View {
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/capture`;
  const text = [
    "📲 <b>Двойной тап по задней крышке</b>",
    "1. Открой «Команды» → «+» → назови «Планер».\n" +
      "2. Добавь «Диктовать текст» (язык: русский).\n" +
      "3. Добавь «Получить содержимое URL»:\n" +
      `   • URL: <code>${url}</code>\n` +
      "   • Метод: POST\n" +
      `   • Заголовок Authorization: <code>Bearer ${token}</code>\n` +
      "   • Тело: JSON, поле <code>text</code> = «Продиктованный текст»\n" +
      "4. Добавь «Получить значение словаря» (ключ <code>message</code>) и «Показать уведомление».\n" +
      "5. Настройки → Универсальный доступ → Касание → Касание задней панели → Двойное касание → «Планер».",
    "Токен — как пароль, никому его не показывай.",
  ].join("\n\n");
  return { text, buttons: [[{ text: "🔄 Перевыпустить токен", callback_data: "tap:new" }]] };
}

export function shortcutAck(online: boolean): View {
  return {
    text: online
      ? "⏳ Собираю команду «Планер» — пришлю файлом через пару секунд."
      : "⏳ Пришлю файл команды, когда Mac проснётся.",
    buttons: [
      [{ text: "🔄 Перевыпустить токен", callback_data: "tap:new" }],
      [{ text: "📝 Настроить вручную", callback_data: "tap:manual" }],
    ],
  };
}
