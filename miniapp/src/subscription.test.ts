import { describe, expect, it } from "vitest";
import { planPrice, proBanner, subStatus } from "./subscription";

const base = { pro_until: null, ai_left: null, ai_per_day: 3, plans: [] };

describe("subscription status", () => {
  it("free shows what is left today", () => {
    expect(subStatus({ ...base, status: "free", ai_left: 2 })).toEqual({
      title: "Free", hint: "Сегодня осталось 2 из 3 действий ИИ (голосовое или вопрос)", pro: false,
    });
  });
  it("trial and pro show the end date", () => {
    expect(subStatus({ ...base, status: "trial", pro_until: "2026-10-15T10:00" }).title).toBe("Пробный Pro до 15.10");
    expect(subStatus({ ...base, status: "pro", pro_until: "2026-11-07T10:00" }).title).toBe("Pro до 07.11");
    expect(subStatus({ ...base, status: "pro", pro_until: "2026-11-07T10:00" }).pro).toBe(true);
  });
  it("lifetime has no end", () => {
    expect(subStatus({ ...base, status: "lifetime" }).title).toBe("Pro навсегда");
  });
  it("plan price says how often it is charged", () => {
    expect(planPrice({ id: "month", title: "Pro · месяц", stars: 150, recurring: true })).toBe("150 ⭐, автопродление");
    expect(planPrice({ id: "lifetime", title: "Founder · навсегда", stars: 2200, recurring: false })).toBe("2200 ⭐ разово");
  });
});

describe("pro banner on the main screen", () => {
  const plans = [{ id: "month" as const, title: "Pro · месяц", stars: 150, recurring: true }];
  it("is hidden once Pro is paid or bought forever", () => {
    expect(proBanner({ ...base, plans, status: "pro", pro_until: "2026-11-07T10:00" })).toBeNull();
    expect(proBanner({ ...base, plans, status: "lifetime" })).toBeNull();
  });
  it("on Free says what is left today and the price", () => {
    expect(proBanner({ ...base, plans, status: "free", ai_left: 1 })).toEqual({
      title: "Pro — голос и вопросы без лимита",
      hint: "Сегодня осталось 1 из 3 · от 150 ⭐ в месяц",
    });
  });
  it("during the trial reminds when it ends", () => {
    expect(proBanner({ ...base, plans, status: "trial", pro_until: "2026-10-15T10:00" })?.title).toBe("Пробный Pro до 15.10");
  });
});
