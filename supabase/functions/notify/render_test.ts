import { assertEquals } from "jsr:@std/assert@1";
import { type Daily, plural, renderDaily, renderReminder, renderWeekly, type Weekly } from "./render.ts";

const DAILY: Daily = {
  date: "2026-10-03", base_currency: "UZS", tasks_done: 3, events_done: 2,
  tasks_left: ["Оплатить интернет", "Купить молоко"], tasks_left_more: 0,
  spent: 280000, month_spent: 300000, limit: 5000000,
  habits: [{ name: "зарядка", done: true }, { name: "чтение", done: false }],
  tomorrow_events: [{ time: "10:00", title: "Созвон с командой" }], tomorrow_tasks: 2,
};

Deno.test("plural", () => {
  assertEquals([plural(1, "задача", "задачи", "задач"), plural(3, "задача", "задачи", "задач"),
    plural(5, "задача", "задачи", "задач"), plural(11, "задача", "задачи", "задач"), plural(21, "задача", "задачи", "задач")],
    ["1 задача", "3 задачи", "5 задач", "11 задач", "21 задача"]);
});

Deno.test("reminder text", () => {
  assertEquals(renderReminder({ item_id: "i", chat_id: 1, title: "Встреча с Амиром", local_time: "15:00", minutes_left: 30 }),
    "⏰ Через 30 минут — Встреча с Амиром (15:00)");
  assertEquals(renderReminder({ item_id: "i", chat_id: 1, title: "Созвон", local_time: "15:00", minutes_left: 12 }),
    "⏰ Через 12 мин — Созвон (15:00)");
});

Deno.test("daily digest full", () => {
  assertEquals(renderDaily(DAILY), [
    "🌙 Итоги дня, 3 октября",
    "✅ Сделано: 3 задачи · 2 встречи",
    "☑️ Не успел: Оплатить интернет, Купить молоко",
    "💸 Потрачено: 280 000 сум · до лимита 4 700 000 сум",
    "🔁 Привычки: ✅ зарядка · ▫️ чтение",
    "📅 Завтра: 10:00 Созвон с командой · 2 задачи со сроком",
  ].join("\n"));
});

Deno.test("daily digest empty day", () => {
  assertEquals(renderDaily({ ...DAILY, tasks_done: 0, events_done: 0, tasks_left: [], spent: 0, limit: null,
    habits: [], tomorrow_events: [], tomorrow_tasks: 0 }),
    "🌙 Итоги дня, 3 октября\nСпокойный день: записей не было.");
});

Deno.test("daily digest more tasks and over limit", () => {
  const text = renderDaily({ ...DAILY, tasks_left_more: 4, month_spent: 6000000 });
  assertEquals(text.split("\n")[2], "☑️ Не успел: Оплатить интернет, Купить молоко и ещё 4");
  assertEquals(text.split("\n")[3], "💸 Потрачено: 280 000 сум · лимит превышен на 1 000 000 сум");
});

const WEEKLY: Weekly = {
  from: "2026-09-28", to: "2026-10-04", base_currency: "UZS", expense: 1200000, prev_expense: 1411765, income: 380000,
  top_categories: [{ name: "кафе", amount: 400000 }, { name: "подписки", amount: 250000 }, { name: "такси", amount: 200000 }],
  tasks_done: 12, events_done: 5,
  habits: [{ name: "зарядка", done_days: 6, streak: 4 }, { name: "чтение", done_days: 3, streak: 0 }],
  next_events: 4, next_tasks: 3,
};

Deno.test("weekly digest", () => {
  assertEquals(renderWeekly(WEEKLY), [
    "📊 Неделя 28.09 – 04.10",
    "💸 Расходы 1 200 000 сум (−15% к прошлой) · доходы 380 000 сум",
    "Топ: кафе 400 000 · подписки 250 000 · такси 200 000",
    "✅ Задач сделано: 12 · встреч: 5",
    "🔁 зарядка 6/7 🔥4 · чтение 3/7",
    "📅 Впереди: 4 встречи, 3 задачи со сроком",
  ].join("\n"));
});

Deno.test("weekly digest without previous week and spending", () => {
  const t = renderWeekly({ ...WEEKLY, expense: 0, prev_expense: 0, income: 0, top_categories: [], habits: [],
    next_events: 0, next_tasks: 0 });
  assertEquals(t, ["📊 Неделя 28.09 – 04.10", "💸 Трат не было", "✅ Задач сделано: 12 · встреч: 5", "📅 Впереди пока пусто"].join("\n"));
  assertEquals(renderWeekly({ ...WEEKLY, prev_expense: 0 }).split("\n")[1], "💸 Расходы 1 200 000 сум · доходы 380 000 сум");
});
