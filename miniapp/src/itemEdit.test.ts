import { describe, expect, it } from "vitest";
import { buildEventPatch, buildHabitPatch, buildNotePatch, buildTaskPatch, splitDue } from "./itemEdit";

describe("splitDue", () => {
  it("hides the 23:59 placeholder time", () => {
    expect(splitDue("2026-10-05T23:59")).toEqual({ date: "2026-10-05", time: "" });
    expect(splitDue("2026-10-05T09:30")).toEqual({ date: "2026-10-05", time: "09:30" });
    expect(splitDue(null)).toEqual({ date: "", time: "" });
  });
});

describe("buildTaskPatch", () => {
  const t = { title: "Оплатить", due: "2026-10-05T23:59" };
  it("returns null without changes", () => {
    expect(buildTaskPatch(t, { title: " Оплатить ", date: "2026-10-05", time: "" })).toBeNull();
  });
  it("sends title and due separately", () => {
    expect(buildTaskPatch(t, { title: "Оплатить интернет", date: "2026-10-05", time: "" })).toEqual({ title: "Оплатить интернет" });
    expect(buildTaskPatch(t, { title: "Оплатить", date: "2026-10-06", time: "09:30" })).toEqual({ due_date: "2026-10-06", due_time: "09:30" });
    expect(buildTaskPatch(t, { title: "Оплатить", date: "2026-10-05", time: "10:00" })).toEqual({ due_date: "2026-10-05", due_time: "10:00" });
  });
  it("clears the due date", () => {
    expect(buildTaskPatch(t, { title: "Оплатить", date: "", time: "" })).toEqual({ due_date: null });
  });
  it("rejects blank title, time without date and bad time", () => {
    expect(buildTaskPatch(t, { title: "  ", date: "2026-10-05", time: "" })).toBe("invalid");
    expect(buildTaskPatch(t, { title: "x", date: "", time: "10:00" })).toBe("invalid");
    expect(buildTaskPatch(t, { title: "x", date: "2026-10-05", time: "9:5" })).toBe("invalid");
    expect(buildTaskPatch(t, { title: "x".repeat(201), date: "", time: "" })).toBe("invalid");
  });
});

describe("buildEventPatch", () => {
  const e = { title: "Встреча", date: "2026-10-06", time: "15:00", with_whom: "Ахмед" };
  it("sends only changed fields", () => {
    expect(buildEventPatch(e, { title: "Встреча", date: "2026-10-06", time: "16:30", withWhom: "Ахмед" })).toEqual({ time: "16:30" });
    expect(buildEventPatch(e, { title: "Встреча", date: "2026-10-07", time: "15:00", withWhom: "" })).toEqual({ date: "2026-10-07", with_whom: "" });
    expect(buildEventPatch(e, { title: "Встреча", date: "2026-10-06", time: "15:00", withWhom: " Ахмед " })).toBeNull();
  });
  it("treats missing with_whom as empty", () => {
    expect(buildEventPatch({ ...e, with_whom: null }, { title: "Встреча", date: "2026-10-06", time: "15:00", withWhom: "" })).toBeNull();
  });
  it("requires date and time", () => {
    expect(buildEventPatch(e, { title: "Встреча", date: "", time: "15:00", withWhom: "" })).toBe("invalid");
    expect(buildEventPatch(e, { title: "Встреча", date: "2026-10-06", time: "", withWhom: "" })).toBe("invalid");
  });
});

describe("buildNotePatch", () => {
  const n = { text: "Идея", kind: "thought" as const };
  it("changes text and kind", () => {
    expect(buildNotePatch(n, { text: "Идея кофейни", kind: "journal" })).toEqual({ text: "Идея кофейни", kind: "journal" });
    expect(buildNotePatch(n, { text: "Идея", kind: "thought" })).toBeNull();
  });
  it("rejects empty and too long text", () => {
    expect(buildNotePatch(n, { text: " ", kind: "thought" })).toBe("invalid");
    expect(buildNotePatch(n, { text: "x".repeat(4001), kind: "thought" })).toBe("invalid");
  });
});

describe("buildHabitPatch", () => {
  const h = { name: "чтение", target_per_week: 7 };
  it("changes name and target", () => {
    expect(buildHabitPatch(h, { name: "книги", target: 3 })).toEqual({ name: "книги", target: 3 });
    expect(buildHabitPatch(h, { name: "чтение", target: 7 })).toBeNull();
  });
  it("rejects blank name and target outside 1..7", () => {
    expect(buildHabitPatch(h, { name: "", target: 7 })).toBe("invalid");
    expect(buildHabitPatch(h, { name: "чтение", target: 0 })).toBe("invalid");
  });
});
