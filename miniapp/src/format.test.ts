import { describe, expect, it } from "vitest";
import { days, dueLabel, fmtAmount, fmtCompact, fmtDayTitle, fmtNumber, fmtRateNote, fmtShortDate, fmtTime, monthShort, monthTitle, relDay, shiftMonth, weekDays } from "./format";

describe("format", () => {
  it("money like the bot", () => {
    expect(fmtNumber(30000)).toBe("30 000");
    expect(fmtNumber(12000000.5)).toBe("12 000 000,50");
    expect(fmtAmount(264738.31, "UZS")).toBe("264 738,31 сум");
    expect(fmtAmount(22.4, "USD")).toBe("22,40 $");
    expect(fmtAmount(5, "GBP")).toBe("5 GBP");
  });
  it("dates", () => {
    expect(fmtTime("2026-10-03T15:00")).toBe("15:00");
    expect(fmtShortDate("2026-10-03T15:00")).toBe("03.10");
    expect(fmtDayTitle("2026-10-03")).toBe("3 октября, суббота");
    expect(monthTitle("2026-10")).toBe("Октябрь 2026");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });
  it("week starts on monday and contains the day", () => {
    expect(weekDays("2026-10-03")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
    expect(weekDays("2026-10-05")[0]).toBe("2026-10-05");
  });
});

describe("fmtRateNote", () => {
  it("shows rate when >= 1", () => {
    expect(fmtRateNote({ amount: 22.4, currency: "USD", rate: 11818.674758 }, "UZS")).toBe("22,40 $ по курсу 11 818,67");
  });
  it("shows inverse when < 1", () => {
    expect(fmtRateNote({ amount: 40000, currency: "UZS", rate: 0.0000846 }, "USD")).toBe("40 000 сум по курсу 1 $ = 11 820,33 сум");
  });
});

describe("короткие числа", () => {
  it("мелкие суммы оставляет как есть", () => {
    expect(fmtCompact(0)).toBe("0");
    expect(fmtCompact(9999)).toBe("9 999");
  });

  it("от десяти тысяч переходит в тысячи", () => {
    expect(fmtCompact(10_000)).toBe("10 тыс.");
    expect(fmtCompact(61_240)).toBe("61 тыс.");
  });

  it("миллионы и миллиарды с одним знаком", () => {
    expect(fmtCompact(1_250_000)).toBe("1,3 млн");
    expect(fmtCompact(2_000_000_000)).toBe("2 млрд");
  });
});

describe("относительные дни", () => {
  const today = "2026-10-07";

  it("знает вчера, сегодня и завтра", () => {
    expect(relDay("2026-10-06", today)).toBe("Вчера");
    expect(relDay("2026-10-07", today)).toBe("Сегодня");
    expect(relDay("2026-10-08", today)).toBe("Завтра");
  });

  it("на остальных днях молчит", () => {
    expect(relDay("2026-10-09", today)).toBeNull();
    expect(relDay("2026-10-05", today)).toBeNull();
  });

  it("работает через границу месяца", () => {
    expect(relDay("2026-11-01", "2026-10-31")).toBe("Завтра");
  });
});

describe("подпись срока", () => {
  const today = "2026-10-07";

  it("23:59 значит «в течение дня» — время не показываем", () => {
    expect(dueLabel("2026-10-07T23:59", today)).toBe("Сегодня");
  });

  it("настоящее время дописывается", () => {
    expect(dueLabel("2026-10-07T14:00", today)).toBe("Сегодня 14:00");
  });

  it("далёкая дата показывается числом", () => {
    expect(dueLabel("2026-10-20T23:59", today)).toBe("20.10");
    expect(dueLabel("2026-10-20T09:15", today)).toBe("20.10 09:15");
  });
});

describe("склонение", () => {
  it("день, дня, дней", () => {
    expect([1, 2, 5, 11, 21, 101, 112].map(days))
      .toEqual(["1 день", "2 дня", "5 дней", "11 дней", "21 день", "101 день", "112 дней"]);
  });
});
