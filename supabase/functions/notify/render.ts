import { fmtAmount, fmtNumber } from "../_shared/money.ts";

export type Reminder = { item_id: string; chat_id: number; title: string; local_time: string; minutes_left: number };
export type DueDigest = { user_id: string; chat_id: number; kind: "daily" | "weekly"; local_date: string };
export type Daily = {
  date: string; base_currency: string; tasks_done: number; events_done: number;
  tasks_left: string[]; tasks_left_more: number; spent: number; month_spent: number; limit: number | null;
  habits: { name: string; done: boolean }[]; tomorrow_events: { time: string; title: string }[]; tomorrow_tasks: number;
};
export type Weekly = {
  from: string; to: string; base_currency: string; expense: number; prev_expense: number; income: number;
  top_categories: { name: string; amount: number }[]; tasks_done: number; events_done: number;
  habits: { name: string; done_days: number; streak: number }[]; next_events: number; next_tasks: number;
};

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${w}`;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const dayTitle = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_GEN[Number(iso.slice(5, 7)) - 1]}`;

export function renderReminder(r: Reminder): string {
  const when = r.minutes_left >= 28 ? "Через 30 минут" : `Через ${r.minutes_left} мин`;
  return `⏰ ${when} — ${r.title} (${r.local_time})`;
}

export function renderDaily(d: Daily): string {
  const cur = d.base_currency;
  const lines: string[] = [];
  const done = [
    d.tasks_done > 0 ? plural(d.tasks_done, "задача", "задачи", "задач") : "",
    d.events_done > 0 ? plural(d.events_done, "встреча", "встречи", "встреч") : "",
  ].filter(Boolean);
  if (done.length) lines.push(`✅ Сделано: ${done.join(" · ")}`);
  if (d.tasks_left.length) {
    lines.push(`☑️ Не успел: ${d.tasks_left.join(", ")}${d.tasks_left_more > 0 ? ` и ещё ${d.tasks_left_more}` : ""}`);
  }
  if (d.spent > 0 || d.limit !== null) {
    let money = `💸 Потрачено: ${fmtAmount(d.spent, cur)}`;
    if (d.limit !== null) {
      const left = d.limit - d.month_spent;
      money += left >= 0 ? ` · до лимита ${fmtAmount(left, cur)}` : ` · лимит превышен на ${fmtAmount(-left, cur)}`;
    }
    lines.push(money);
  }
  if (d.habits.length) lines.push(`🔁 Привычки: ${d.habits.map((h) => `${h.done ? "✅" : "▫️"} ${h.name}`).join(" · ")}`);
  const tomorrow = [
    ...d.tomorrow_events.map((e) => `${e.time} ${e.title}`),
    ...(d.tomorrow_tasks > 0 ? [`${plural(d.tomorrow_tasks, "задача", "задачи", "задач")} со сроком`] : []),
  ];
  if (tomorrow.length) lines.push(`📅 Завтра: ${tomorrow.join(" · ")}`);
  const head = `🌙 Итоги дня, ${dayTitle(d.date)}`;
  return [head, ...(lines.length ? lines : ["Спокойный день: записей не было."])].join("\n");
}

export function renderWeekly(w: Weekly): string {
  const cur = w.base_currency;
  const lines = [`📊 Неделя ${ddmm(w.from)} – ${ddmm(w.to)}`];
  if (w.expense === 0 && w.income === 0) {
    lines.push("💸 Трат не было");
  } else {
    let money = `💸 Расходы ${fmtAmount(w.expense, cur)}`;
    if (w.prev_expense > 0) {
      const pct = Math.round(((w.expense - w.prev_expense) / w.prev_expense) * 100);
      money += pct === 0 ? " (как на прошлой)" : ` (${pct > 0 ? "+" : "−"}${Math.abs(pct)}% к прошлой)`;
    }
    if (w.income > 0) money += ` · доходы ${fmtAmount(w.income, cur)}`;
    lines.push(money);
  }
  if (w.top_categories.length) {
    lines.push(`Топ: ${w.top_categories.map((c) => `${c.name} ${fmtNumber(c.amount)}`).join(" · ")}`);
  }
  lines.push(`✅ Задач сделано: ${w.tasks_done} · встреч: ${w.events_done}`);
  if (w.habits.length) {
    lines.push(`🔁 ${w.habits.map((h) => `${h.name} ${h.done_days}/7${h.streak > 0 ? ` 🔥${h.streak}` : ""}`).join(" · ")}`);
  }
  const ahead = [
    w.next_events > 0 ? plural(w.next_events, "встреча", "встречи", "встреч") : "",
    w.next_tasks > 0 ? `${plural(w.next_tasks, "задача", "задачи", "задач")} со сроком` : "",
  ].filter(Boolean);
  lines.push(ahead.length ? `📅 Впереди: ${ahead.join(", ")}` : "📅 Впереди пока пусто");
  return lines.join("\n");
}
