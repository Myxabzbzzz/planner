/**
 * Книга Excel из выгрузки export_data: записи по листам и графики на первом листе.
 *
 * Все даты — в часовом поясе человека и настоящими датами Excel, а не строками:
 * по ним работают фильтр, сортировка и сводные таблицы.
 */
import type { Doc } from "../_shared/telegram.ts";
import { type Cell, type Chart, type Sheet, writeXlsx } from "./xlsx.ts";

type Tx = {
  type: "expense" | "income"; amount_base: number | string; base_currency: string;
  amount_orig: number | string | null; currency_orig: string | null; category: string | null;
  comment: string | null; occurred_at: string;
};
type Item = {
  kind: "task" | "event"; title: string; notes: string | null; due_at: string | null; due_has_time: boolean | null;
  priority: string; done_at: string | null; starts_at: string | null; duration_min: number | null;
  with_whom: string | null; created_at: string;
};
type Note = { kind: string; text: string; tags: string[] | null; created_at: string };
type Habit = { name: string; target_per_week: number; archived_at: string | null; created_at: string; logs: string[] };
type Category = { name: string; type: "expense" | "income"; is_default: boolean; color?: string | null };

export type ExportData = {
  exported_at: string;
  profile: { name: string | null; tz: string | null; base_currency: string; tg_username: string | null; created_at: string };
  categories: Category[];
  budgets: { category: string | null; monthly_limit: number | string }[];
  items: Item[];
  transactions: Tx[];
  notes: Note[];
  habits: Habit[];
};

/** Светлые ступени палитры категорий из миниаппа (styles.css) — цвета в файле те же, что в приложении. */
export const PALETTE: Record<string, string> = {
  blue: "2A78D6", orange: "EB6834", aqua: "1BAF7A", yellow: "EDA100",
  magenta: "E87BA4", green: "008300", violet: "4A3AA7", red: "E34948",
};
const SLOT_ORDER = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"];
const INCOME = "0A7A57";
const EXPENSE = "CE3A2C";
const NEUTRAL = "9E9E9E";
const OTHER = "Остальное";
const NO_CATEGORY = "Без категории";

/** Сколько категорий получают свой цвет; остальные складываются в «Остальное». */
const TOP_CATEGORIES = 7;
const CHART_MONTHS = 12;
const HABIT_WEEKS = 12;
const MAX_HABIT_LINES = 8;

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const PRIORITY: Record<string, string> = { low: "низкий", normal: "обычный", high: "высокий" };
const NOTE_KIND: Record<string, string> = { thought: "мысль", journal: "дневник" };

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v) || 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

type Local = { y: number; m: number; d: number; hh: number; mm: number };

/** Время в поясе человека. Неизвестный пояс — UTC, а не падение всей выгрузки. */
export function localClock(tz: string | null) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  }
  return (iso: string): Local => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(iso))) {
      if (part.type !== "literal") p[part.type] = Number(part.value);
    }
    return { y: p.year, m: p.month, d: p.day, hh: p.hour, mm: p.minute };
  };
}

/** Порядковый номер даты в Excel (система 1900). */
export const serial = (t: Local) => Date.UTC(t.y, t.m - 1, t.d, t.hh, t.mm) / 86_400_000 + 25_569;
const dateOnly = (iso: string): Local => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10), hh: 0, mm: 0 });
const monthKey = (t: Local) => `${t.y}-${String(t.m).padStart(2, "0")}`;
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Понедельник недели, в которую попадает день (в днях от эпохи). */
const mondayOf = (t: Local) => {
  const day = Date.UTC(t.y, t.m - 1, t.d) / 86_400_000;
  return day - ((new Date(day * 86_400_000).getUTCDay() + 6) % 7);
};

const H = (s: string): Cell => ({ v: s, s: "header" });
const date = (n: number | null): Cell => (n === null ? null : { v: n, s: "date" });
const dateTime = (n: number | null): Cell => (n === null ? null : { v: n, s: "datetime" });
const money = (n: number): Cell => ({ v: round2(n), s: "money" });

/**
 * Цвет категории: свой, если выбран; иначе — свободная ступень палитры по порядку,
 * как в миниаппе: цвет держится за категорию, а не за место в рейтинге.
 */
function categoryColors(names: string[], own: Map<string, string>): Map<string, string> {
  const taken = new Set([...own.values()]);
  const free = SLOT_ORDER.filter((k) => !taken.has(PALETTE[k])).map((k) => PALETTE[k]);
  const out = new Map<string, string>();
  for (const n of names) out.set(n, own.get(n) ?? free.shift() ?? NEUTRAL);
  return out;
}

export function buildWorkbook(data: ExportData, nowIso: string): Sheet[] {
  const tz = data.profile.tz;
  const at = localClock(tz);
  const cur = data.profile.base_currency;
  const now = at(nowIso);
  const nowMonth = monthKey(now);

  const txs = data.transactions.map((t) => ({ ...t, local: at(t.occurred_at), amount: num(t.amount_base) }));
  const tasks = data.items.filter((i) => i.kind === "task");
  const events = data.items.filter((i) => i.kind === "event");

  // ---- помесячно ----
  const touched = [
    ...txs.map((t) => monthKey(t.local)),
    ...data.items.map((i) => monthKey(at(i.created_at))),
    ...data.notes.map((n) => monthKey(at(n.created_at))),
  ].sort();
  const months = monthsBetween(touched[0] && touched[0] < nowMonth ? touched[0] : nowMonth, nowMonth);
  const byMonth = new Map(months.map((m) => [m, { income: 0, expense: 0, created: 0, done: 0, events: 0, notes: 0 }]));
  for (const t of txs) {
    const row = byMonth.get(monthKey(t.local));
    if (row) row[t.type] += t.amount;
  }
  for (const i of tasks) {
    const c = byMonth.get(monthKey(at(i.created_at)));
    if (c) c.created++;
    const d = i.done_at ? byMonth.get(monthKey(at(i.done_at))) : undefined;
    if (d) d.done++;
  }
  for (const e of events) {
    const row = byMonth.get(monthKey(at(e.starts_at ?? e.created_at)));
    if (row) row.events++;
  }
  for (const n of data.notes) {
    const row = byMonth.get(monthKey(at(n.created_at)));
    if (row) row.notes++;
  }

  // ---- категории ----
  const spend = new Map<string, { total: number; count: number; type: "expense" | "income" }>();
  for (const t of txs) {
    const key = `${t.type}\u0000${t.category ?? NO_CATEGORY}`;
    const row = spend.get(key) ?? { total: 0, count: 0, type: t.type };
    row.total += t.amount;
    row.count++;
    spend.set(key, row);
  }
  const expenseCats = [...spend.entries()]
    .filter(([, v]) => v.type === "expense" && v.total > 0)
    .map(([k, v]) => ({ name: k.split("\u0000")[1], total: v.total }))
    .sort((a, b) => b.total - a.total);
  const own = new Map<string, string>();
  for (const c of data.categories) {
    if (c.type === "expense" && c.color && PALETTE[c.color]) own.set(c.name, PALETTE[c.color]);
  }
  const top = expenseCats.length > TOP_CATEGORIES + 1 ? expenseCats.slice(0, TOP_CATEGORIES) : expenseCats;
  const folded = expenseCats.length > top.length;
  const colors = categoryColors(top.map((c) => c.name), own);

  const chartMonths = months.slice(-CHART_MONTHS);
  const matrix = chartMonths.map((m) => {
    const row = new Map<string, number>();
    for (const t of txs) {
      if (t.type !== "expense" || monthKey(t.local) !== m) continue;
      const name = t.category ?? NO_CATEGORY;
      const key = top.some((c) => c.name === name) ? name : OTHER;
      row.set(key, (row.get(key) ?? 0) + t.amount);
    }
    return row;
  });
  const stackNames = [...top.map((c) => c.name), ...(folded ? [OTHER] : [])];

  // ---- привычки по неделям ----
  const thisMonday = mondayOf(now);
  const weeks = Array.from({ length: HABIT_WEEKS }, (_, i) => thisMonday - (HABIT_WEEKS - 1 - i) * 7);
  const activeHabits = data.habits.filter((h) => !h.archived_at).slice(0, MAX_HABIT_LINES);
  const habitWeeks = activeHabits.map((h) => {
    const counts = new Map<number, number>();
    for (const d of h.logs) {
      const w = mondayOf(dateOnly(d));
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return weeks.map((w) => counts.get(w) ?? 0);
  });
  const weekLabel = (day: number) => {
    const d = new Date(day * 86_400_000);
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  // ---- листы с данными для графиков ----
  const S_MONTHS = "По месяцам";
  const S_CATS = "Категории";
  const S_MATRIX = "Категории по месяцам";
  const S_HABITW = "Привычки по неделям";

  const monthsSheet: Sheet = {
    name: S_MONTHS,
    freeze: 1,
    widths: [12, 14, 14, 14, 14, 16, 10, 10],
    rows: [
      [H("Месяц"), H(`Доходы, ${cur}`), H(`Расходы, ${cur}`), H(`Баланс, ${cur}`),
        H("Задач создано"), H("Задач выполнено"), H("Встреч"), H("Заметок")],
      ...months.map((m) => {
        const r = byMonth.get(m)!;
        return [monthLabel(m), money(r.income), money(r.expense), money(r.income - r.expense),
          r.created, r.done, r.events, r.notes] as Cell[];
      }),
    ],
  };
  // строки последних месяцев на листе «По месяцам» (с нуля, после заголовка)
  const mFrom = 1 + months.length - chartMonths.length;
  const mTo = months.length;

  const limits = new Map(data.budgets.map((b) => [b.category ?? "", num(b.monthly_limit)]));
  const catRows = [...spend.entries()]
    .map(([k, v]) => ({ name: k.split("\u0000")[1], ...v }))
    .sort((a, b) => (a.type === b.type ? b.total - a.total : a.type === "expense" ? -1 : 1));
  const catSheet: Sheet = {
    name: S_CATS,
    freeze: 1,
    filter: 0,
    widths: [24, 10, 16, 11, 16],
    rows: [
      [H("Категория"), H("Тип"), H(`Всего, ${cur}`), H("Операций"), H(`Лимит в месяц, ${cur}`)],
      ...catRows.map((c) => [c.name, c.type === "expense" ? "расход" : "доход", money(c.total), c.count,
        limits.has(c.name) ? money(limits.get(c.name)!) : null] as Cell[]),
      // категории без единой операции — тоже часть настроек человека
      ...data.categories
        .filter((c) => !spend.has(`${c.type}\u0000${c.name}`))
        .map((c) => [c.name, c.type === "expense" ? "расход" : "доход", money(0), 0,
          limits.has(c.name) ? money(limits.get(c.name)!) : null] as Cell[]),
    ],
  };
  const expenseRowsInCats = catRows.filter((c) => c.type === "expense" && c.total > 0).length;

  const matrixSheet: Sheet = {
    name: S_MATRIX,
    freeze: 1,
    widths: [12, ...stackNames.map(() => 14)],
    rows: [
      [H("Месяц"), ...stackNames.map((n) => H(n))],
      ...chartMonths.map((m, i) => [monthLabel(m), ...stackNames.map((n) => money(matrix[i].get(n) ?? 0))] as Cell[]),
    ],
  };

  const habitSheet: Sheet = {
    name: S_HABITW,
    freeze: 1,
    widths: [12, ...activeHabits.map(() => 16)],
    rows: [
      [H("Неделя с"), ...activeHabits.map((h) => H(h.name))],
      // подпись недели — текстом: с датой-числом в ячейке ось графика показывала бы порядковые номера
      ...weeks.map((w, i) => [weekLabel(w), ...habitWeeks.map((c) => c[i])] as Cell[]),
    ],
  };

  // ---- графики ----
  const monthCats = chartMonths.map(monthLabel);
  // Графики друг под другом: в превью Telegram на телефоне файл листают вниз.
  // Строка по умолчанию — 20 px, график 360 px занимает 18 строк, плюс одна пустая.
  const charts: Chart[] = [];
  const place = (k: number) => ({ col: 0, row: 10 + k * 19, width: 720, height: 360 });

  charts.push({
    type: "column",
    title: `Доходы и расходы по месяцам, ${cur}`,
    categories: monthCats,
    catRef: { sheet: S_MONTHS, col: 0, from: mFrom, to: mTo },
    series: [
      { name: `Доходы, ${cur}`, values: chartMonths.map((m) => round2(byMonth.get(m)!.income)),
        ref: { sheet: S_MONTHS, col: 1, from: mFrom, to: mTo }, color: INCOME },
      { name: `Расходы, ${cur}`, values: chartMonths.map((m) => round2(byMonth.get(m)!.expense)),
        ref: { sheet: S_MONTHS, col: 2, from: mFrom, to: mTo }, color: EXPENSE },
    ],
    at: place(0),
  });
  if (expenseRowsInCats > 0) {
    const shown = catRows.filter((c) => c.type === "expense" && c.total > 0).slice(0, 12);
    charts.push({
      type: "bar",
      title: `Расходы по категориям за всё время, ${cur}`,
      categories: shown.map((c) => c.name),
      catRef: { sheet: S_CATS, col: 0, from: 1, to: shown.length },
      series: [{ name: `Всего, ${cur}`, values: shown.map((c) => round2(c.total)),
        ref: { sheet: S_CATS, col: 2, from: 1, to: shown.length }, color: NEUTRAL }],
      pointColors: shown.map((c) => colors.get(c.name) ?? NEUTRAL),
      labels: true,
      max: Math.ceil(shown[0].total * 1.25),
      at: place(1),
    });
  }
  if (stackNames.length > 0) {
    charts.push({
      type: "stacked",
      title: `Расходы по категориям по месяцам, ${cur}`,
      categories: monthCats,
      catRef: { sheet: S_MATRIX, col: 0, from: 1, to: chartMonths.length },
      series: stackNames.map((n, k) => ({
        name: n,
        values: matrix.map((row) => round2(row.get(n) ?? 0)),
        ref: { sheet: S_MATRIX, col: k + 1, from: 1, to: chartMonths.length },
        color: colors.get(n) ?? NEUTRAL,
      })),
      at: place(charts.length),
    });
  }
  charts.push({
    type: "column",
    title: "Задачи по месяцам",
    categories: monthCats,
    catRef: { sheet: S_MONTHS, col: 0, from: mFrom, to: mTo },
    series: [
      { name: "Задач создано", values: chartMonths.map((m) => byMonth.get(m)!.created),
        ref: { sheet: S_MONTHS, col: 4, from: mFrom, to: mTo }, color: PALETTE.blue },
      { name: "Задач выполнено", values: chartMonths.map((m) => byMonth.get(m)!.done),
        ref: { sheet: S_MONTHS, col: 5, from: mFrom, to: mTo }, color: PALETTE.aqua },
    ],
    at: place(charts.length),
  });
  if (activeHabits.length > 0) {
    charts.push({
      type: "line",
      title: "Привычки: отметок за неделю",
      categories: weeks.map(weekLabel),
      catRef: { sheet: S_HABITW, col: 0, from: 1, to: weeks.length },
      series: activeHabits.map((h, k) => ({
        name: h.name,
        values: habitWeeks[k],
        ref: { sheet: S_HABITW, col: k + 1, from: 1, to: weeks.length },
        color: PALETTE[SLOT_ORDER[k]],
      })),
      numFmt: "0",
      at: place(charts.length),
    });
  }

  // ---- сводка ----
  const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const doneTasks = tasks.filter((t) => t.done_at).length;
  const exportedAt = serial(at(data.exported_at || nowIso));
  const summary: Sheet = {
    name: "Графики",
    gridlines: false,
    widths: [22, 16, 4, 22, 16],
    rows: [
      [{ v: "Планировщик — выгрузка", s: "title" }],
      [{ v: [data.profile.name, data.profile.tg_username && `@${data.profile.tg_username}`].filter(Boolean).join(" · ") ||
        "—", s: "muted" }],
      [{ v: "Выгружено", s: "muted" }, dateTime(exportedAt)],
      [],
      [{ v: `Доходы, ${cur}`, s: "bold" }, { v: round2(income), s: "boldMoney" }, null,
        { v: "Задач", s: "bold" }, `${tasks.length} (выполнено ${doneTasks})`],
      [{ v: `Расходы, ${cur}`, s: "bold" }, { v: round2(expense), s: "boldMoney" }, null,
        { v: "Встреч", s: "bold" }, events.length],
      [{ v: `Баланс, ${cur}`, s: "bold" }, { v: round2(income - expense), s: "boldMoney" }, null,
        { v: "Заметок", s: "bold" }, data.notes.length],
      [{ v: "Операций", s: "bold" }, txs.length, null,
        { v: "Привычек", s: "bold" }, `${data.habits.filter((h) => !h.archived_at).length} активных`],
      [{ v: `Графики — за последние ${chartMonths.length} мес. и ${HABIT_WEEKS} недель. Числа для них — на листах «По месяцам», «Категории» и соседних.`, s: "muted" }],
    ],
    charts,
  };

  // ---- записи ----
  const txSheet: Sheet = {
    name: "Операции",
    freeze: 1,
    filter: 0,
    widths: [17, 9, 20, 14, 14, 9, 36],
    rows: [
      [H("Дата"), H("Тип"), H("Категория"), H(`Сумма, ${cur}`), H("В валюте"), H("Валюта"), H("Комментарий")],
      ...[...txs].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((t) => [
        dateTime(serial(t.local)),
        t.type === "expense" ? "расход" : "доход",
        t.category ?? NO_CATEGORY,
        money(t.type === "expense" ? -t.amount : t.amount),
        t.amount_orig !== null && t.currency_orig && t.currency_orig !== t.base_currency
          ? money(t.type === "expense" ? -num(t.amount_orig) : num(t.amount_orig))
          : null,
        t.currency_orig && t.currency_orig !== t.base_currency ? t.currency_orig : null,
        t.comment ?? "",
      ] as Cell[]),
    ],
  };

  const due = (i: Item): Cell => {
    if (!i.due_at) return null;
    return i.due_has_time ? dateTime(serial(at(i.due_at))) : date(serial({ ...at(i.due_at), hh: 0, mm: 0 }));
  };
  const taskSheet: Sheet = {
    name: "Задачи",
    freeze: 1,
    filter: 0,
    widths: [40, 17, 11, 11, 17, 17, 40],
    rows: [
      [H("Задача"), H("Срок"), H("Приоритет"), H("Статус"), H("Выполнена"), H("Создана"), H("Заметки")],
      ...tasks.map((t) => [
        t.title, due(t), PRIORITY[t.priority] ?? t.priority, t.done_at ? "выполнена" : "открыта",
        t.done_at ? dateTime(serial(at(t.done_at))) : null, dateTime(serial(at(t.created_at))), t.notes ?? "",
      ] as Cell[]),
    ],
  };

  const eventSheet: Sheet = {
    name: "Встречи",
    freeze: 1,
    filter: 0,
    widths: [17, 40, 13, 24, 40],
    rows: [
      [H("Начало"), H("Встреча"), H("Длительность, мин"), H("С кем"), H("Заметки")],
      ...[...events].sort((a, b) => (b.starts_at ?? "").localeCompare(a.starts_at ?? "")).map((e) => [
        e.starts_at ? dateTime(serial(at(e.starts_at))) : null, e.title, e.duration_min, e.with_whom ?? "", e.notes ?? "",
      ] as Cell[]),
    ],
  };

  const noteSheet: Sheet = {
    name: "Заметки",
    freeze: 1,
    filter: 0,
    widths: [17, 10, 80, 20],
    rows: [
      [H("Дата"), H("Тип"), H("Текст"), H("Теги")],
      ...[...data.notes].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((n) => [
        dateTime(serial(at(n.created_at))), NOTE_KIND[n.kind] ?? n.kind, n.text, (n.tags ?? []).join(", "),
      ] as Cell[]),
    ],
  };

  const habitList: Sheet = {
    name: "Привычки",
    freeze: 1,
    filter: 0,
    widths: [28, 14, 12, 14, 14, 14],
    rows: [
      [H("Привычка"), H("Цель в неделю"), H("Отметок"), H("Последняя"), H("Создана"), H("В архиве с")],
      ...data.habits.map((h) => {
        const last = h.logs.length ? h.logs[h.logs.length - 1] : null;
        return [
          h.name, h.target_per_week, h.logs.length, last ? date(serial(dateOnly(last))) : null,
          date(serial({ ...at(h.created_at), hh: 0, mm: 0 })),
          h.archived_at ? date(serial({ ...at(h.archived_at), hh: 0, mm: 0 })) : null,
        ] as Cell[];
      }),
    ],
  };

  const marks: Sheet = {
    name: "Отметки привычек",
    freeze: 1,
    filter: 0,
    widths: [28, 12],
    rows: [
      [H("Привычка"), H("Дата")],
      ...data.habits.flatMap((h) => h.logs.map((d) => [h.name, date(serial(dateOnly(d)))] as Cell[])),
    ],
  };

  return [summary, txSheet, taskSheet, eventSheet, noteSheet, habitList, marks, monthsSheet, catSheet, matrixSheet,
    habitSheet];
}

type CategoryList = { expense?: { name: string; color?: string | null }[]; income?: { name: string; color?: string | null }[] };

/** Цвета категорий появились позже export_data — берём их из списка категорий. */
export function withColors(data: ExportData, list: CategoryList | null): ExportData {
  const color = new Map<string, string | null>();
  for (const type of ["expense", "income"] as const) {
    for (const c of list?.[type] ?? []) color.set(`${type}\u0000${c.name}`, c.color ?? null);
  }
  return {
    ...data,
    categories: data.categories.map((c) => ({ ...c, color: color.get(`${c.type}\u0000${c.name}`) ?? null })),
  };
}

export async function exportFile(data: ExportData, format: "xlsx" | "json", nowIso: string): Promise<Doc> {
  const t = localClock(data.profile.tz)(nowIso);
  const day = `${t.y}-${String(t.m).padStart(2, "0")}-${String(t.d).padStart(2, "0")}`;
  if (format === "json") {
    return { name: `planner-${day}.json`, bytes: new TextEncoder().encode(JSON.stringify(data, null, 2)), mime: "application/json" };
  }
  return {
    name: `planner-${day}.xlsx`,
    bytes: await writeXlsx(buildWorkbook(data, nowIso)),
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
