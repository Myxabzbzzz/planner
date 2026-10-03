import { describe, expect, it } from "vitest";
import { habitView } from "./habitView";

const days = [{ date: "2026-10-02", done: true }, { date: "2026-10-03", done: false }];

describe("habitView", () => {
  it("passes server data through without override", () => {
    const h = { days, streak: 1, done_today: false };
    expect(habitView(h, undefined)).toEqual({ done: false, streak: 1, days });
  });
  it("marking today adds one and fills the last cell", () => {
    const v = habitView({ days, streak: 1, done_today: false }, true);
    expect(v.streak).toBe(2);
    expect(v.days[1]).toEqual({ date: "2026-10-03", done: true });
    expect(v.days[0]).toBe(days[0]);
  });
  it("unmarking today removes one and clears the last cell", () => {
    const d2 = [{ date: "2026-10-02", done: true }, { date: "2026-10-03", done: true }];
    const v = habitView({ days: d2, streak: 2, done_today: true }, false);
    expect(v.streak).toBe(1);
    expect(v.days[1].done).toBe(false);
  });
  it("never goes below zero and override equal to server is a no-op", () => {
    expect(habitView({ days: [{ date: "d", done: true }], streak: 0, done_today: true }, false).streak).toBe(0);
    const h = { days, streak: 3, done_today: true };
    expect(habitView(h, true).days).toBe(days);
  });
});
