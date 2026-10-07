import { describe, expect, it } from "vitest";
import { autoRate, badgesOf, finishRate, LEVELS, levelOf, WEIGHTS, xpOf } from "./gamify";
import type { Profile } from "./types";

const empty: Profile = {
  name: "Тест", tz: "Europe/Moscow", base_currency: "RUB", since: "2026-10-01",
  days_known: 1, active_days: 0, active_streak: 0,
  tasks: { open: 0, overdue: 0, done_total: 0, done_30d: 0, created_30d: 0 },
  events: { total: 0, done_total: 0, next_7d: 0 },
  habits: { active: 0, best_streak: 0, logs_total: 0, week_done: 0, week_target: 0 },
  notes: { total: 0, thoughts: 0, journals: 0, d30: 0 },
  captures: { total: 0, done: 0, needs_review: 0, failed: 0 },
  money: { limit: null, months: [] },
  weeks: [], heat: [], heat_total: 0,
};

const make = (p: Partial<Profile>): Profile => ({ ...empty, ...p });

describe("опыт", () => {
  it("у пустого профиля равен нулю", () => {
    expect(xpOf(empty)).toBe(0);
  });

  it("складывается из всех источников по своим весам", () => {
    const p = make({
      tasks: { ...empty.tasks, done_total: 3 },
      habits: { ...empty.habits, logs_total: 5 },
      notes: { ...empty.notes, total: 2 },
      events: { ...empty.events, done_total: 4 },
      active_days: 6,
    });
    expect(xpOf(p)).toBe(3 * WEIGHTS.task + 5 * WEIGHTS.habit + 2 * WEIGHTS.note + 4 * WEIGHTS.event + 6 * WEIGHTS.day);
  });
});

describe("уровень", () => {
  it("пустой профиль — первый уровень, прогресс 0", () => {
    const l = levelOf(empty);
    expect([l.index, l.title, l.progress]).toEqual([1, "Начало", 0]);
  });

  it("ровно на пороге переходит на следующий уровень", () => {
    // 12 закрытых задач = 120 опыта = порог второго уровня
    const l = levelOf(make({ tasks: { ...empty.tasks, done_total: 12 } }));
    expect([l.index, l.xp, l.from, l.progress]).toEqual([2, 120, 120, 0]);
  });

  it("на середине уровня даёт прогресс 0,5", () => {
    const mid = (LEVELS[0].at + LEVELS[1].at) / 2; // 60
    const l = levelOf(make({ tasks: { ...empty.tasks, done_total: mid / WEIGHTS.task } }));
    expect([l.index, l.progress]).toEqual([1, 0.5]);
  });

  it("на последнем уровне next пустой, а прогресс полный", () => {
    const l = levelOf(make({ active_days: 10_000 }));
    expect([l.index, l.title, l.next, l.progress])
      .toEqual([LEVELS.length, LEVELS[LEVELS.length - 1].title, null, 1]);
  });

  it("прогресс никогда не выходит за 0…1", () => {
    for (const days of [0, 1, 7, 50, 300, 5000]) {
      const l = levelOf(make({ active_days: days }));
      expect(l.progress).toBeGreaterThanOrEqual(0);
      expect(l.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe("награды", () => {
  it("у пустого профиля не получена ни одна, кроме «чистого стола»", () => {
    const got = badgesOf(empty).filter((b) => b.got).map((b) => b.key);
    expect(got).toEqual(["clean"]); // просрочек нет, потому что задач нет
  });

  it("серия активных дней открывает «Неделю», но ещё не «Месяц»", () => {
    const by = Object.fromEntries(badgesOf(make({ active_streak: 9 })).map((b) => [b.key, b]));
    expect(by.week.got).toBe(true);
    expect(by.month.got).toBe(false);
    expect([by.month.have, by.month.need]).toEqual([9, 30]);
  });

  it("прогресс не перескакивает цель", () => {
    const by = Object.fromEntries(badgesOf(make({ active_streak: 400 })).map((b) => [b.key, b]));
    expect([by.week.have, by.week.need]).toEqual([7, 7]);
    expect([by.month.have, by.month.need]).toEqual([30, 30]);
  });

  it("просрочка закрывает «Чистый стол»", () => {
    const by = Object.fromEntries(
      badgesOf(make({ tasks: { ...empty.tasks, open: 4, overdue: 2 } })).map((b) => [b.key, b]),
    );
    expect(by.clean.got).toBe(false);
  });

  it("«В рамках» требует лимит и траты не выше него", () => {
    const within = make({ money: { limit: 90_000, months: [{ month: "2026-10", expense: 61_000, income: 0 }] } });
    const over = make({ money: { limit: 90_000, months: [{ month: "2026-10", expense: 95_000, income: 0 }] } });
    const noLimit = make({ money: { limit: null, months: [{ month: "2026-10", expense: 100, income: 0 }] } });
    const get = (p: Profile) => badgesOf(p).find((b) => b.key === "budget")!.got;
    expect([get(within), get(over), get(noLimit)]).toEqual([true, false, false]);
  });

  it("смотрит на последний месяц, а не на первый", () => {
    const p = make({
      money: {
        limit: 50_000,
        months: [{ month: "2026-09", expense: 999_999, income: 0 }, { month: "2026-10", expense: 10_000, income: 0 }],
      },
    });
    expect(badgesOf(p).find((b) => b.key === "budget")!.got).toBe(true);
  });
});

describe("проценты", () => {
  it("доля доведённых считается от появившихся за месяц", () => {
    expect(finishRate(make({ tasks: { ...empty.tasks, done_30d: 8, created_30d: 10 } }))).toBeCloseTo(0.8);
  });

  it("без появившихся задач процент не показываем", () => {
    expect(finishRate(empty)).toBeNull();
  });

  it("закрыть можно больше, чем появилось за месяц — но не больше 100 %", () => {
    expect(finishRate(make({ tasks: { ...empty.tasks, done_30d: 30, created_30d: 10 } }))).toBe(1);
  });

  it("автоматичность разбора считается от обработанного, а не от всего", () => {
    const p = make({ captures: { total: 50, done: 8, needs_review: 1, failed: 1 } });
    expect(autoRate(p)).toBeCloseTo(0.8); // 10 в очереди в знаменатель не идут
    expect(autoRate(empty)).toBeNull();
  });
});
