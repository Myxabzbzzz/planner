import { describe, expect, it } from "vitest";
import { planPrice, subStatus } from "./subscription";

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
