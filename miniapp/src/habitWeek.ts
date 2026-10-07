/**
 * Недельная цель привычки.
 *
 * `target_per_week` хранился в базе, редактировался в шторке и не использовался
 * нигде: и бот, и сетка считали «подряд дней» и «N/7». Для «зал 3 раза в неделю»
 * это давало «серии нет» при идеально выполненной неделе.
 * Здесь неделя считается выполненной, если отметок не меньше цели.
 */
import type { HabitDay } from "./types";

const parse = (iso: string) => Date.parse(iso.slice(0, 10) + "T00:00:00Z");
const weekday = (iso: string) => (new Date(parse(iso)).getUTCDay() + 6) % 7;

export type WeekProgress = { done: number; target: number; met: boolean; left: number };

/** Отметки текущей календарной недели (с понедельника по последний день в данных). */
export function weekProgress(days: HabitDay[], target: number): WeekProgress {
  const last = days[days.length - 1];
  const done = last === undefined
    ? 0
    : days.filter((d) => parse(d.date) >= parse(last.date) - weekday(last.date) * 86_400_000 && d.done).length;
  return { done, target, met: done >= target, left: Math.max(0, target - done) };
}

/** Сколько недель подряд цель выполнена — честная «полоса» для цели меньше 7. */
export function weeksMet(days: HabitDay[], target: number): number {
  if (days.length === 0) return 0;
  const buckets = new Map<number, number>();
  for (const d of days) {
    if (!d.done) continue;
    const t = parse(d.date);
    const monday = t - weekday(d.date) * 86_400_000;
    buckets.set(monday, (buckets.get(monday) ?? 0) + 1);
  }
  const last = days[days.length - 1];
  let monday = parse(last.date) - weekday(last.date) * 86_400_000;
  const thisWeek = buckets.get(monday) ?? 0;
  // Текущая неделя ещё не кончилась: она не обрывает счёт, но и не считается,
  // пока цель не достигнута.
  let streak = thisWeek >= target ? 1 : 0;
  monday -= 7 * 86_400_000;
  const first = parse(days[0].date);
  while (monday >= first) {
    if ((buckets.get(monday) ?? 0) < target) break;
    streak += 1;
    monday -= 7 * 86_400_000;
  }
  return streak;
}
