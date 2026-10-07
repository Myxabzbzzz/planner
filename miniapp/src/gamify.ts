/**
 * Правила уровней и наград. Сервер отдаёт только факты (`api_profile`),
 * а всё, что можно посчитать, считается здесь — чтобы покрыть тестами без базы.
 *
 * Принципиально: ничего не выдумываем. Каждое число выводится из реально
 * сделанного. И никакого давления: награды показывают, что уже получилось,
 * серия не обрывается до конца дня, «пропустил» нигде не осуждается.
 */
import type { Profile } from "./types";

export const WEIGHTS = { task: 10, habit: 6, note: 4, event: 6, day: 8 } as const;

/** Порог — суммарный опыт, с которого начинается уровень. */
export const LEVELS: { at: number; title: string }[] = [
  { at: 0, title: "Начало" },
  { at: 120, title: "Втянулся" },
  { at: 320, title: "В ритме" },
  { at: 650, title: "Уверенно" },
  { at: 1100, title: "Собранность" },
  { at: 1750, title: "Дисциплина" },
  { at: 2600, title: "Хозяин дня" },
  { at: 3700, title: "Мастер ритма" },
  { at: 5100, title: "Невозмутимость" },
  { at: 7000, title: "Легенда" },
];

export function xpOf(p: Profile): number {
  return p.tasks.done_total * WEIGHTS.task
    + p.habits.logs_total * WEIGHTS.habit
    + p.notes.total * WEIGHTS.note
    + p.events.done_total * WEIGHTS.event
    + p.active_days * WEIGHTS.day;
}

export type Level = {
  index: number;      // 1-based, как показываем человеку
  title: string;
  xp: number;
  from: number;       // опыт на входе в уровень
  next: number | null; // опыт следующего уровня, null на последнем
  progress: number;   // 0…1 внутри уровня
};

export function levelOf(p: Profile): Level {
  const xp = xpOf(p);
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].at) i += 1;
  const from = LEVELS[i].at;
  const next = i + 1 < LEVELS.length ? LEVELS[i + 1].at : null;
  return {
    index: i + 1,
    title: LEVELS[i].title,
    xp,
    from,
    next,
    progress: next === null ? 1 : Math.min(1, (xp - from) / (next - from)),
  };
}

export type Badge = {
  key: string;
  label: string;
  hint: string;
  got: boolean;
  have: number;
  need: number;
};

const badge = (key: string, label: string, hint: string, have: number, need: number): Badge => ({
  key,
  label,
  hint,
  have: Math.min(have, need),
  need,
  got: have >= need,
});

export function badgesOf(p: Profile): Badge[] {
  const month = p.money.months[p.money.months.length - 1];
  const limit = p.money.limit;
  const withinLimit = limit !== null && month !== undefined && month.expense <= limit;
  return [
    badge("first", "Первый шаг", "первая запись", p.captures.total, 1),
    badge("week", "Неделя", "7 активных дней подряд", p.active_streak, 7),
    badge("month", "Месяц", "30 активных дней подряд", p.active_streak, 30),
    badge("stripe7", "Полоса 7", "привычка 7 дней подряд", p.habits.best_streak, 7),
    badge("stripe30", "Полоса 30", "привычка 30 дней подряд", p.habits.best_streak, 30),
    badge("tasks100", "Сотня", "100 закрытых задач", p.tasks.done_total, 100),
    badge("journal", "Дневник", "30 записей в дневник", p.notes.journals, 30),
    badge("days100", "Сто дней", "100 активных дней", p.active_days, 100),
    badge("clean", "Чистый стол", "ни одной просрочки", p.tasks.overdue === 0 ? 1 : 0, 1),
    badge("budget", "В рамках", "месяц внутри лимита", withinLimit ? 1 : 0, 1),
  ];
}

/**
 * Доля задач, доведённых до конца за 30 дней. Если за месяц ничего не появлялось,
 * процент не рисуем — доля от нуля ничего не значит.
 */
export function finishRate(p: Profile): number | null {
  const made = p.tasks.created_30d;
  if (made <= 0) return null;
  return Math.min(1, p.tasks.done_30d / made);
}

/** Насколько ИИ справляется сам: разобрано без уточнений из всего обработанного. */
export function autoRate(p: Profile): number | null {
  const handled = p.captures.done + p.captures.needs_review + p.captures.failed;
  if (handled <= 0) return null;
  return p.captures.done / handled;
}
