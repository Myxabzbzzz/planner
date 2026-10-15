import { describe, expect, it } from "vitest";
import { forecastText, regularWhen } from "./forecast";
import type { Forecast } from "./types";

const base: Forecast = {
  base_currency: "RUB", month: "2026-10", spent: 40000, forecast: 90000, prev_month: 80000,
  regular_left: 0, days_left: 16, limit: null,
};

describe("прогноз", () => {
  it("с лимитом говорит, выйдешь ли за него", () => {
    expect(forecastText({ ...base, limit: 85000 })).toMatchObject({ warn: true, hint: "Выйдешь за лимит примерно на 5 000 ₽." });
    expect(forecastText({ ...base, limit: 100000 }).hint).toBe("В лимит укладываешься, запас ≈ 10 000 ₽.");
  });
  it("без лимита сравнивает с прошлым месяцем", () => {
    expect(forecastText(base).hint).toBe("Это на 13% больше, чем в прошлом месяце.");
    expect(forecastText({ ...base, forecast: 80000 }).hint).toBe("Это столько же, сколько в прошлом месяце.");
  });
  it("упоминает регулярные платежи впереди", () => {
    expect(forecastText({ ...base, regular_left: 299, prev_month: 0 }).hint)
      .toBe("Темп по тратам этого месяца. С учётом регулярных платежей впереди: 299 ₽.");
  });
  it("в первые дни прогноза нет", () => {
    expect(forecastText({ ...base, forecast: null }).title).toBe("Прогноз появится через пару дней");
  });
  it("когда следующий регулярный платёж", () => {
    expect(regularWhen(5, "2026-11-05")).toBe("каждое 5-е · следующий 05.11");
  });
});
