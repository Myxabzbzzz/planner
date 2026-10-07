/**
 * Данные к графикам.
 *
 * Пончик на 7 категорий убран: на телефоне он требует легенды и всё равно не даёт
 * сравнить величины. Вместо него 100 % полоса состава + ранжированные бары.
 * Поэтому цвет здесь порядковый (ранг = величина), а не категориальный: один
 * янтарный тон в пять ступеней. Обе рампы (тёмная и светлая) прогнаны через
 * dataviz/scripts/validate_palette.js --ordinal и проходят все проверки,
 * поэтому отдаём CSS-переменные — тема переключается сама.
 */

/** Ступени от самой крупной доли к самой мелкой. */
export const RAMP = ["var(--r1)", "var(--r2)", "var(--r3)", "var(--r4)", "var(--r5)"] as const;
export const OTHER = "Другое";

export type Share = { name: string; amount: number; share: number; color: string };

/**
 * Топ-(n−1) категорий плюс «Другое». Девятой ступени не бывает:
 * хвост всегда сворачивается, иначе цвета пришлось бы повторять.
 */
export function categoryShares(items: { name: string; amount: number }[], slots = RAMP.length): Share[] {
  const positive = items.filter((i) => i.amount > 0);
  const total = positive.reduce((s, i) => s + i.amount, 0);
  if (total <= 0) return [];
  const sorted = [...positive].sort((a, b) => b.amount - a.amount);
  const head = sorted.length > slots ? sorted.slice(0, slots - 1) : sorted;
  const tail = sorted.length > slots ? sorted.slice(slots - 1) : [];
  const rows = [...head];
  if (tail.length > 0) rows.push({ name: OTHER, amount: tail.reduce((s, i) => s + i.amount, 0) });
  return rows.map((r, i) => ({ ...r, share: r.amount / total, color: RAMP[i] }));
}

export function barHeights(byDay: { date: string; expense: number }[], month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const map = new Map(byDay.map((d) => [Number(d.date.slice(8, 10)), d.expense]));
  const max = Math.max(0, ...byDay.map((d) => d.expense));
  return Array.from({ length: days }, (_, i) => {
    const value = map.get(i + 1) ?? 0;
    return { day: i + 1, value, h: max > 0 ? value / max : 0 };
  });
}

const parse = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
/** 0 = понедельник. */
const weekday = (iso: string) => (new Date(parse(iso)).getUTCDay() + 6) % 7;

export type Cell<T> = { date: string; value: T } | null;

/**
 * Календарные недели, а не «по 7 от начала массива».
 * Раньше колонки не совпадали с неделями, и нельзя было увидеть «срываюсь на выходных».
 * Пустые места в начале и конце — null, чтобы строка «Пн» всегда была строкой «Пн».
 */
export function weekColumns<T>(days: { date: string; value: T }[]): Cell<T>[][] {
  if (days.length === 0) return [];
  const cols: Cell<T>[][] = [];
  let col: Cell<T>[] = Array.from({ length: 7 }, () => null);
  let filled = false;
  for (const d of days) {
    const wd = weekday(d.date);
    if (filled && wd === 0) {
      cols.push(col);
      col = Array.from({ length: 7 }, () => null);
    }
    col[wd] = d;
    filled = true;
  }
  if (filled) cols.push(col);
  return cols;
}

/** 0…4 — пять ступеней заливки клетки по доле отмеченных привычек за день. */
export function heatLevel(done: number, total: number): 0 | 1 | 2 | 3 | 4 {
  if (done <= 0) return 0;
  if (total <= 0) return 4;
  const share = done / total;
  if (share >= 1) return 4;
  if (share >= 0.66) return 3;
  if (share >= 0.33) return 2;
  return 1;
}

/** Высоты для парных столбиков «закрыто / появилось» — общий масштаб на оба ряда. */
export function duoHeights(weeks: { week: string; done: number; created: number }[]) {
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.done, w.created)));
  return weeks.map((w) => ({ ...w, hDone: w.done / max, hCreated: w.created / max }));
}

/** Общий масштаб для расходов и доходов по месяцам. */
export function monthHeights(months: { month: string; expense: number; income: number }[]) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.expense, m.income)));
  return months.map((m) => ({ ...m, hExpense: m.expense / max, hIncome: m.income / max }));
}
