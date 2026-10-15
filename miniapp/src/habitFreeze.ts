import type { HabitDay } from "./types";

/**
 * Серию можно спасти заморозкой, если вчера пропущено, а позавчера — отмечено или заморожено:
 * ровно одна дыра, которая и рвёт цепочку. Возвращает дату, которую стоит заморозить.
 */
export function rescuableDay(days: HabitDay[]): string | null {
  if (days.length < 3) return null;
  const yesterday = days[days.length - 2];
  const before = days[days.length - 3];
  if (yesterday.done || yesterday.frozen) return null;
  return before.done || before.frozen ? yesterday.date : null;
}

/**
 * Кнопка «Сохранить серию» появляется только для незамороженного пропуска за неделю,
 * поэтому отказ сервера (409) на деле значит одно — заморозки месяца кончились.
 */
export const FREEZE_LIMIT = "Заморозки на этот месяц закончились — их две на привычку.";
