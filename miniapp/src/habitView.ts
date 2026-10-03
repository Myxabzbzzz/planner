import type { HabitDay } from "./types";

type HabitRow = { days: HabitDay[]; streak: number; done_today: boolean };

// Server streak counts today when it is done, otherwise the chain ending yesterday,
// so flipping today moves it by exactly one.
export function habitView(h: HabitRow, over: boolean | undefined): { done: boolean; streak: number; days: HabitDay[] } {
  const done = over ?? h.done_today;
  if (done === h.done_today) return { done, streak: h.streak, days: h.days };
  const last = h.days.length - 1;
  return {
    done,
    streak: Math.max(0, h.streak + (done ? 1 : -1)),
    days: h.days.map((d, i) => (i === last ? { ...d, done } : d)),
  };
}
