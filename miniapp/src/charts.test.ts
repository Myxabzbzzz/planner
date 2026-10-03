import { describe, expect, it } from "vitest";
import { barHeights, donutSlices, habitColumns, PALETTE } from "./charts";

describe("charts", () => {
  it("donut slices cover the circle", () => {
    const s = donutSlices([{ name: "кафе", amount: 300 }, { name: "такси", amount: 100 }]);
    expect(s.map((x) => x.share)).toEqual([0.75, 0.25]);
    expect(s[1].offset).toBe(0.75);
    expect(s[0].color).toBe(PALETTE[0]);
    expect(donutSlices([])).toEqual([]);
  });
  it("bars fill every day of the month and handle zero max", () => {
    const b = barHeights([{ date: "2026-10-03", expense: 50 }, { date: "2026-10-10", expense: 100 }], "2026-10");
    expect(b).toHaveLength(31);
    expect(b[2]).toEqual({ day: 3, value: 50, h: 0.5 });
    expect(b[9].h).toBe(1);
    expect(barHeights([], "2026-02").every((x) => x.h === 0)).toBe(true);
    expect(barHeights([], "2026-02")).toHaveLength(28);
  });
  it("habit days become week columns", () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ date: `d${i}`, done: i % 2 === 0 }));
    const cols = habitColumns(days);
    expect(cols).toHaveLength(2);
    expect(cols[0]).toHaveLength(7);
    expect(cols[1][6]).toEqual({ date: "d13", done: false });
  });
});
