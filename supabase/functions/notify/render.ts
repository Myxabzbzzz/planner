import { fmtAmount, fmtNumber } from "../_shared/money.ts";

export type Reminder = {
  item_id: string;
  chat_id: number;
  kind: "task" | "event";
  title: string;
  local_time: string | null;
  minutes_left: number;
};
export type ReviewPing = { inbox_id: string; user_id: string; chat_id: number; pending: number; sample: string | null };
export type SleepingQueue = { user_id: string; chat_id: number; queued: number; oldest_hours: number };
export type DueDigest = { user_id: string; chat_id: number; kind: "daily" | "weekly"; local_date: string };
export type Daily = {
  date: string; base_currency: string; tasks_done: number; events_done: number;
  events_past: number;
  tasks_left: string[]; tasks_left_more: number; spent: number; month_spent: number; limit: number | null;
  habits: { name: string; done: boolean }[]; tomorrow_events: { time: string; title: string }[]; tomorrow_tasks: number;
};
export type Weekly = {
  from: string; to: string; base_currency: string; expense: number; prev_expense: number; income: number;
  top_categories: { name: string; amount: number }[]; tasks_done: number; events_done: number; events_past: number;
  habits: { name: string; done_days: number; streak: number; target: number }[]; next_events: number; next_tasks: number;
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
  // #14: у задач со сроком не было напоминаний вообще
  if (r.kind === "task") {
    return r.local_time === null
      ? `⏰ Сегодня срок — ☑️ ${r.title}`
      : `⏰ Через ${r.minutes_left} мин срок — ☑️ ${r.title} (до ${r.local_time})`;
  }
  const when = r.minutes_left >= 28 ? "Через 30 минут" : `Через ${r.minutes_left} мин`;
  return `⏰ ${when} — ${r.title} (${r.local_time})`;
}

// #8: вопрос «куда отнести» мог навсегда утонуть в чате
export function renderReviewPing(p: ReviewPing): string {
  const what = p.sample ? `«${p.sample.slice(0, 80)}»` : "записи";
  return p.pending === 1
    ? `❓ Остался без ответа вопрос про ${what} — ответь на сообщение выше или убери запись.`
    : `❓ Остались без ответа ${p.pending} вопроса (например, про ${what}) — ответь выше или убери запись.`;
}

// #10: очередь была невидимой — человек не знал ни сколько накопилось, ни что с этим делать
export function renderSleeping(q: SleepingQueue): string {
  const hours = q.oldest_hours >= 48
    ? `${Math.round(q.oldest_hours / 24)} дн.`
    : `${q.oldest_hours} ч`;
  return `😴 ИИ ещё спит. В очереди ${plural(q.queued, "запись", "записи", "записей")}, ` +
    `самая старая ждёт ${hours}. Всё разберу, как только он проснётся — ничего не потеряется.`;
}

export function renderDaily(d: Daily): string {
  const cur = d.base_currency;
  const lines: string[] = [];
  const done = [
    d.tasks_done > 0 ? plural(d.tasks_done, "задача", "задачи", "задач") : "",
    d.events_done > 0 ? plural(d.events_done, "встреча", "встречи", "встреч") : "",
  ].filter(Boolean);
  if (done.length) lines.push(`✅ Сделано: ${done.join(" · ")}`);
  // #31: прошедшие, но не отмеченные встречи раньше шли в «Сделано» — это была неправда
  if (d.events_past > 0) {
    lines.push(`📅 Прошли, но не отмечены: ${plural(d.events_past, "встреча", "встречи", "встреч")}`);
  }
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
  lines.push(
    `✅ Задач сделано: ${w.tasks_done} · встреч: ${w.events_done}` +
      (w.events_past > 0 ? ` (ещё ${w.events_past} прошли без отметки)` : ""),
  );
  if (w.habits.length) {
    // #18: было жёсткое «/7», хотя у привычки есть своя цель на неделю
    lines.push(
      `🔁 ${
        w.habits.map((h) =>
          `${h.name} ${h.done_days}/${h.target}${h.done_days >= h.target ? " 🎯" : ""}${
            h.streak > 0 ? ` 🔥${h.streak}` : ""
          }`
        ).join(" · ")
      }`,
    );
  }
  const ahead = [
    w.next_events > 0 ? plural(w.next_events, "встреча", "встречи", "встреч") : "",
    w.next_tasks > 0 ? `${plural(w.next_tasks, "задача", "задачи", "задач")} со сроком` : "",
  ].filter(Boolean);
  lines.push(ahead.length ? `📅 Впереди: ${ahead.join(", ")}` : "📅 Впереди пока пусто");
  return lines.join("\n");
}
