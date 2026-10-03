import { describe, expect, it } from "vitest";
import { fmtAmount, fmtDayTitle, fmtNumber, fmtShortDate, fmtTime, monthTitle, shiftMonth, weekDays } from "./format";

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
