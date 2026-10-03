import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  fmtAmount, fmtNumber, renderHabits, renderMoney, renderNotify, renderSettings, renderTapGuide, renderTasks, renderToday, tzChoice,
} from "./views.ts";
import { MENU_ROWS, menuKey } from "./keyboard.ts";

const H1 = "30000000-0000-0000-0000-000000000001";
const T1 = "20000000-0000-0000-0000-000000000001";
const T2 = "20000000-0000-0000-0000-000000000002";

Deno.test("fmtNumber / fmtAmount", () => {
  assertEquals(fmtNumber(30000), "30 000");
  assertEquals(fmtNumber(0), "0");
  assertEquals(fmtNumber(12000000.5), "12 000 000,50");
  assertEquals(fmtAmount(12000000.5, "UZS"), "12 000 000,50 сум");
  assertEquals(fmtAmount(22.4, "USD"), "22,40 $");
  assertEquals(fmtAmount(5, "GBP"), "5 GBP");
});

Deno.test("menu keyboard layout and lookup", () => {
  assertEquals(MENU_ROWS, [["📅 Сегодня", "☑️ Задачи"], ["💸 Деньги", "🔁 Привычки"], ["📱 Приложение", "⚙️ Настройки"]]);
  assertEquals(menuKey("📅 Сегодня"), "today");
  assertEquals(menuKey(" ⚙️ Настройки "), "settings");
  assertEquals(menuKey("сегодня"), null);
  assertEquals(menuKey(undefined), null);
});

Deno.test("renderToday full", () => {
  const v = renderToday({
    base_currency: "UZS",
    events: [{ title: "Встреча с Андреем", time: "15:00" }],
    tasks: [{ id: T1, title: "Оплатить интернет", overdue: false }, { id: T2, title: "Сдать отчёт", overdue: true }],
    spent_today: 30000,
    month_spent: 30000,
    limit: 5000000, tasks_more: 0,
    habits: [{ id: H1, name: "зарядка", done: false }, { id: "x", name: "чтение", done: true }],
  });
  assertEquals(v.text, [
    "📅 Сегодня",
    "Встречи:\n• 15:00 Встреча с Андреем",
    "Задачи:\n• Оплатить интернет\n• ⚠️ Сдать отчёт (просрочено)",
    "💸 Потрачено сегодня: 30 000 сум\nЛимит на месяц: осталось 4 970 000 сум из 5 000 000 сум",
    "🔁 Привычки: ▫️ зарядка · ✅ чтение",
  ].join("\n\n"));
  assertEquals(v.buttons, [[{ text: "✔️ зарядка", callback_data: `hab:${H1}:t` }]]);
});

Deno.test("renderToday empty and over limit", () => {
  const v = renderToday({
    base_currency: "UZS", events: [], tasks: [], spent_today: 0, month_spent: 6000000, limit: 5000000, habits: [], tasks_more: 0,
  });
  assertEquals(v.text, [
    "📅 Сегодня",
    "Сегодня ничего не запланировано.",
    "💸 Потрачено сегодня: 0 сум\nЛимит на месяц превышен на 1 000 000 сум",
  ].join("\n\n"));
  assertEquals(v.buttons, undefined);
});

Deno.test("renderTasks numbered with buttons", () => {
  const v = renderTasks({ tasks: [
    { id: T1, title: "Сдать отчёт", due: "02.10", overdue: true },
    { id: T2, title: "Купить молоко", due: null, overdue: false },
  ], total: 2 });
  assertEquals(v.text, "☑️ Задачи (2)\n\n1. ⚠️ Сдать отчёт — до 02.10\n2. Купить молоко");
  assertEquals(v.buttons, [[{ text: "✅ 1", callback_data: `done:${T1}` }, { text: "✅ 2", callback_data: `done:${T2}` }]]);
  assertEquals(renderTasks({ tasks: [], total: 0 }).text, "☑️ Задачи\n\nОткрытых задач нет 🎉");
});

Deno.test("renderTasks buttons wrap by 5", () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({
    id: `20000000-0000-0000-0000-00000000000${i}`, title: `t${i}`, due: null, overdue: false,
  }));
  const v = renderTasks({ tasks, total: 6 });
  assertEquals(v.buttons!.map((r) => r.length), [5, 1]);
  assert(v.buttons!.flat().every((b) => new TextEncoder().encode(b.callback_data!).length <= 64));
});

Deno.test("renderMoney", () => {
  const v = renderMoney({
    base_currency: "UZS", month: "10.2026", expense: 30000, income: 100000,
    by_category: [{ name: "такси/транспорт", amount: 30000 }], limit: 5000000,
  });
  assertEquals(v.text, [
    "💸 Деньги за 10.2026",
    "Расходы: 30 000 сум\nДоходы: 100 000 сум\nЛимит: 5 000 000 сум, осталось 4 970 000 сум",
    "По категориям:\n• такси/транспорт — 30 000 сум",
  ].join("\n\n"));
  assertEquals(
    renderMoney({ base_currency: "UZS", month: "10.2026", expense: 0, income: 0, by_category: [], limit: null }).text,
    "💸 Деньги за 10.2026\n\nВ этом месяце трат нет.",
  );
});

Deno.test("renderHabits", () => {
  const v = renderHabits({ habits: [
    { id: H1, name: "зарядка", week: [true, true, false, true, true, true, false], streak: 3, done_today: false },
  ] });
  assertEquals(v.text, "🔁 Привычки\n\nзарядка — ✅✅▫️✅✅✅▫️ · серия 3");
  assertEquals(v.buttons, [[{ text: "✔️ зарядка", callback_data: `hab:${H1}:h` }]]);
  assertEquals(renderHabits({ habits: [] }).text, "🔁 Привычки\n\nПривычек пока нет. Скажи «хочу трекать зарядку».");
});

Deno.test("renderSettings and tzChoice", () => {
  const v = renderSettings({ tz: "Asia/Tashkent", base_currency: "UZS", limit: null, capture_token: "t",
    notify_reminders: true, notify_daily: true, notify_weekly: false });
  assertEquals(v.text, "⚙️ Настройки\n\n🕐 Часовой пояс: Ташкент (Asia/Tashkent)\n💱 Базовая валюта: UZS\n💰 Лимит на месяц: не задан");
  assertEquals(v.buttons, [
    [{ text: "🕐 Часовой пояс", callback_data: "set:tz" }],
    [{ text: "💰 Лимит на месяц", callback_data: "set:limit" }],
    [{ text: "📲 Двойной тап", callback_data: "set:tap" }],
    [{ text: "🔔 Уведомления", callback_data: "set:notify" }],
  ]);
  const t = tzChoice();
  assertEquals(t.buttons!.flat().map((b) => b.callback_data),
    ["tz:tashkent", "tz:moscow", "tz:almaty", "tz:kyiv", "tz:dubai", "tz:berlin"]);
});

Deno.test("renderTapGuide contains url, token and rotate button", () => {
  const tok = "a".repeat(64);
  const v = renderTapGuide("https://x.supabase.co", tok);
  assert(v.text.includes("<code>https://x.supabase.co/functions/v1/capture</code>"));
  assert(v.text.includes(`<code>Bearer ${tok}</code>`));
  assertEquals(v.buttons, [[{ text: "🔄 Перевыпустить токен", callback_data: "tap:new" }]]);
});

Deno.test("renderToday shows overflow of tasks", () => {
  const v = renderToday({
    base_currency: "UZS", events: [], tasks: [{ id: T1, title: "a", overdue: false }], tasks_more: 5,
    spent_today: 0, month_spent: 0, limit: null, habits: [],
  });
  assert(v.text.includes("Задачи:\n• a\n• …и ещё 5"));
});

Deno.test("renderTasks header uses total and shows overflow", () => {
  const tasks = [{ id: T1, title: "a", due: null, overdue: false }];
  const v = renderTasks({ tasks, total: 35 });
  assertEquals(v.text, "☑️ Задачи (35)\n\n1. a\n…и ещё 34");
});

Deno.test("renderNotify shows toggles", () => {
  const v = renderNotify({ tz: "Asia/Tashkent", base_currency: "UZS", limit: null, capture_token: "t",
    notify_reminders: true, notify_daily: false, notify_weekly: true });
  assertEquals(v.text, "🔔 Уведомления\n\nНажми, чтобы включить или выключить.");
  assertEquals(v.buttons, [
    [{ text: "🔔 Напоминания о встречах", callback_data: "nt:reminders" }],
    [{ text: "🔕 Итоги дня в 21:30", callback_data: "nt:daily" }],
    [{ text: "🔔 Итоги недели (вс, 21:30)", callback_data: "nt:weekly" }],
  ]);
});
