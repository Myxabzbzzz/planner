import { describe, expect, it } from "vitest";
import { barHeights, categoryShares, duoHeights, heatLevel, monthHeights, OTHER, RAMP, weekColumns } from "./charts";

describe("доли категорий", () => {
  it("сортирует по величине и считает доли", () => {
    const s = categoryShares([{ name: "Дом", amount: 100 }, { name: "Еда", amount: 300 }]);
    expect(s.map((x) => [x.name, x.share])).toEqual([["Еда", 0.75], ["Дом", 0.25]]);
  });

  it("раскрашивает по рангу, от самой крупной ступени", () => {
    const s = categoryShares([{ name: "a", amount: 1 }, { name: "b", amount: 2 }]);
    expect(s.map((x) => x.color)).toEqual([RAMP[0], RAMP[1]]);
  });

  it("свой цвет категории побеждает ранг и не переезжает при смене порядка", () => {
    const colorOf = (n: string) => (n === "еда" ? "var(--cat-green)" : null);
    const a = categoryShares([{ name: "еда", amount: 5 }, { name: "дом", amount: 1 }], RAMP.length, colorOf);
    const b = categoryShares([{ name: "еда", amount: 1 }, { name: "дом", amount: 5 }], RAMP.length, colorOf);
    expect(a.map((x) => [x.name, x.color])).toEqual([["еда", "var(--cat-green)"], ["дом", RAMP[1]]]);
    expect(b.map((x) => [x.name, x.color])).toEqual([["дом", RAMP[0]], ["еда", "var(--cat-green)"]]);
  });

  it("хвост сворачивается в «Другое», цветов ровно столько, сколько ступеней", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ name: `к${i}`, amount: 9 - i }));
    const s = categoryShares(items);
    expect(s.length).toBe(RAMP.length);
    expect(s[s.length - 1].name).toBe(OTHER);
    expect(s[s.length - 1].amount).toBe(5 + 4 + 3 + 2 + 1); // хвост: пятая и дальше
    expect(new Set(s.map((x) => x.color)).size).toBe(RAMP.length);
  });

  it("ровно по числу ступеней — ничего не сворачивает", () => {
    const items = Array.from({ length: RAMP.length }, (_, i) => ({ name: `к${i}`, amount: i + 1 }));
    expect(categoryShares(items).some((x) => x.name === OTHER)).toBe(false);
  });

  it("доли всегда дают в сумме единицу", () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ name: `к${i}`, amount: (i * 7) % 13 + 1 }));
    const sum = categoryShares(items).reduce((s, x) => s + x.share, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("нули и пустота не рисуются", () => {
    expect(categoryShares([])).toEqual([]);
    expect(categoryShares([{ name: "a", amount: 0 }])).toEqual([]);
    expect(categoryShares([{ name: "a", amount: 0 }, { name: "b", amount: 5 }]).map((x) => x.name)).toEqual(["b"]);
  });
});

describe("столбики по дням", () => {
  it("растягивает месяц на все его дни и нормирует по максимуму", () => {
    const bars = barHeights([{ date: "2026-02-10", expense: 50 }, { date: "2026-02-20", expense: 100 }], "2026-02");
    expect(bars.length).toBe(28);
    expect(bars[9]).toEqual({ day: 10, value: 50, h: 0.5 });
    expect(bars[19]).toEqual({ day: 20, value: 100, h: 1 });
    expect(bars[0]).toEqual({ day: 1, value: 0, h: 0 });
  });

  it("знает про високосный год", () => {
    expect(barHeights([], "2028-02").length).toBe(29);
  });

  it("месяц без трат не делит на ноль", () => {
    expect(barHeights([], "2026-10").every((b) => b.h === 0)).toBe(true);
  });
});

describe("календарные недели", () => {
  // 2026-10-07 — среда
  const days = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(from + "T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10),
      value: i,
    }));

  it("колонка — это календарная неделя, а начало добивается пустыми клетками", () => {
    const cols = weekColumns(days("2026-10-07", 3)); // ср, чт, пт
    expect(cols.length).toBe(1);
    expect(cols[0].map((c) => (c === null ? null : c.date)))
      .toEqual([null, null, "2026-10-07", "2026-10-08", "2026-10-09", null, null]);
  });

  it("новая колонка начинается именно с понедельника", () => {
    const cols = weekColumns(days("2026-10-10", 5)); // сб, вс | пн, вт, ср
    expect(cols.length).toBe(2);
    expect(cols[0][5]?.date).toBe("2026-10-10"); // суббота в первой
    expect(cols[0][6]?.date).toBe("2026-10-11"); // воскресенье в первой
    expect(cols[1][0]?.date).toBe("2026-10-12"); // понедельник открывает вторую
  });

  it("ровные 28 дней с понедельника дают 4 полные недели", () => {
    const cols = weekColumns(days("2026-10-05", 28)); // 5 октября 2026 — понедельник
    expect(cols.length).toBe(4);
    expect(cols.every((c) => c.every((x) => x !== null))).toBe(true);
  });

  it("каждый день стоит в строке своего дня недели", () => {
    for (const col of weekColumns(days("2026-09-30", 20))) {
      col.forEach((cell, wd) => {
        if (cell === null) return;
        expect((new Date(Date.parse(cell.date + "T00:00:00Z")).getUTCDay() + 6) % 7).toBe(wd);
      });
    }
  });

  it("пустой список — ни одной колонки", () => {
    expect(weekColumns([])).toEqual([]);
  });
});

describe("ступени тепла", () => {
  it("ноль отмеченных — нулевая ступень", () => {
    expect(heatLevel(0, 4)).toBe(0);
  });

  it("всё отмечено — верхняя ступень", () => {
    expect(heatLevel(4, 4)).toBe(4);
  });

  it("растёт вместе с долей", () => {
    expect([heatLevel(1, 4), heatLevel(2, 4), heatLevel(3, 4)]).toEqual([1, 2, 3]);
  });

  it("отметки без активных привычек не ломают шкалу", () => {
    expect(heatLevel(2, 0)).toBe(4);
  });
});

describe("парные и месячные столбики", () => {
  it("делят общий масштаб, чтобы ряды были сравнимы", () => {
    const d = duoHeights([{ week: "w1", done: 5, created: 10 }, { week: "w2", done: 10, created: 0 }]);
    expect([d[0].hDone, d[0].hCreated]).toEqual([0.5, 1]);
    expect([d[1].hDone, d[1].hCreated]).toEqual([1, 0]);
  });

  it("пустые недели не делят на ноль", () => {
    const d = duoHeights([{ week: "w", done: 0, created: 0 }]);
    expect([d[0].hDone, d[0].hCreated]).toEqual([0, 0]);
  });

  it("расходы и доходы нормируются вместе", () => {
    const m = monthHeights([{ month: "2026-09", expense: 50, income: 200 }]);
    expect([m[0].hExpense, m[0].hIncome]).toEqual([0.25, 1]);
  });
});
