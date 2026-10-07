/**
 * Один хронологический список на «Сегодня».
 * Раньше встречи и задачи лежали в двух отдельных карточках, и порядок дня
 * приходилось собирать в голове: встреча в 10:30, задача «до 14:00», встреча в 19:30.
 * Теперь всё со временем идёт по времени, а задачи без времени — в конце.
 */
import type { Today } from "./types";

export type AgendaRow =
  | { kind: "event"; key: string; at: string | null; item: Today["events"][number] }
  | { kind: "task"; key: string; at: string | null; item: Today["tasks"][number] };

/** Срок «23:59» означает «в течение дня», а не «к полуночи» — времени не показываем. */
export const taskTime = (due: string): string | null => {
  const t = due.slice(11, 16);
  return t === "" || t === "23:59" ? null : t;
};

export function buildAgenda(data: Pick<Today, "events" | "tasks">): AgendaRow[] {
  const rows: AgendaRow[] = [
    ...data.events.map((e): AgendaRow => ({ kind: "event", key: `e:${e.id}`, at: e.time || null, item: e })),
    ...data.tasks.map((t): AgendaRow => ({ kind: "task", key: `t:${t.id}`, at: taskTime(t.due), item: t })),
  ];
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.at === b.r.at) return a.i - b.i; // стабильно: сохраняем порядок сервера
      if (a.r.at === null) return 1;
      if (b.r.at === null) return -1;
      return a.r.at < b.r.at ? -1 : 1;
    })
    .map(({ r }) => r);
}

/** Сколько из сегодняшнего уже закрыто — для кольца «день» в шапке. */
export function dayProgress(
  data: Pick<Today, "events" | "tasks" | "habits">,
  over: Record<string, boolean>,
): { done: number; total: number } {
  const items = [
    ...data.events.map((e) => ({ k: `e:${e.id}`, d: e.done })),
    ...data.tasks.map((t) => ({ k: `t:${t.id}`, d: false })),
    ...data.habits.map((h) => ({ k: `h:${h.id}`, d: h.done })),
  ];
  return { done: items.filter((x) => over[x.k] ?? x.d).length, total: items.length };
}
