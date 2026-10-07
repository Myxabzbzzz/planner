import { describe, expect, it } from "vitest";
import { weekProgress, weeksMet } from "./habitWeek";
import type { HabitDay } from "./types";

/** 2026-10-05 — понедельник. Удобная точка отсчёта для всех недельных проверок. */
const MONDAY = "2026-10-05";
const day = (from: string, i: number) =>
  new Date(Date.parse(from + "T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10);

/** `marks` — номера дней от `from`, которые отмечены. */
const series = (from: string, n: number, marks: number[]): HabitDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: day(from, i), done: marks.includes(i) }));

describe("прогресс недели", () => {
  it("считает только текущую календарную неделю", () => {
    // две недели: на прошлой 3 отметки, на этой 1
    const days = series("2026-09-28", 10, [0, 1, 2, 7]);
    expect(weekProgress(days, 3)).toEqual({ done: 1, target: 3, met: false, left: 2 });
  });

  it("цель 3 из 7 выполнена, когда отметок три — хоть пн, ср, пт", () => {
    const days = series(MONDAY, 5, [0, 2, 4]);
    expect(weekProgress(days, 3)).toEqual({ done: 3, target: 3, met: true, left: 0 });
  });

  it("перевыполнение не даёт отрицательного остатка", () => {
    const days = series(MONDAY, 7, [0, 1, 2, 3, 4]);
    expect(weekProgress(days, 3)).toEqual({ done: 5, target: 3, met: true, left: 0 });
  });

  it("неделя начинается с понедельника, а не «семь дней назад»", () => {
    // воскресенье 2026-10-11 отмечено, и предыдущая суббота тоже
    const days = series("2026-10-10", 2, [0, 1]);
    // суббота и воскресенье в одной неделе с понедельником 05-го
    expect(weekProgress(days, 2).done).toBe(2);
  });

  it("пустая история — ноль без падения", () => {
    expect(weekProgress([], 5)).toEqual({ done: 0, target: 5, met: false, left: 5 });
  });
});

describe("полоса недель", () => {
  it("считает подряд идущие выполненные недели", () => {
    // 4 недели с понедельника, в каждой по 3 отметки
    const marks = [0, 1, 2, 7, 8, 9, 14, 15, 16, 21, 22, 23];
    expect(weeksMet(series("2026-09-14", 28, marks), 3)).toBe(4);
  });

  it("недобранная неделя обрывает полосу", () => {
    // последняя неделя полная, предыдущая — только 1 отметка
    const marks = [0, 1, 2, 7, 14, 15, 16];
    expect(weeksMet(series("2026-09-21", 21, marks), 3)).toBe(1);
  });

  it("незаконченная текущая неделя не обрывает полосу прошлых", () => {
    // прошлая неделя выполнена (3 отметки), текущая только началась (1 отметка):
    // полоса — одна прошлая неделя, текущая пока не считается
    const marks = [0, 1, 2, 7];
    expect(weeksMet(series("2026-09-28", 10, marks), 3)).toBe(1);
    // как только цель текущей недели взята, она добавляется к полосе
    const withGoal = [0, 1, 2, 7, 8, 9];
    expect(weeksMet(series("2026-09-28", 10, withGoal), 3)).toBe(2);
  });

  it("ни одной отметки — нулевая полоса", () => {
    expect(weeksMet(series(MONDAY, 14, []), 1)).toBe(0);
    expect(weeksMet([], 3)).toBe(0);
  });

  it("цель 7 — это ровно «каждый день»", () => {
    const every = Array.from({ length: 14 }, (_, i) => i);
    expect(weeksMet(series("2026-09-28", 14, every), 7)).toBe(2);
    const oneMissed = every.filter((i) => i !== 3);
    expect(weeksMet(series("2026-09-28", 14, oneMissed), 7)).toBe(1);
  });
});
