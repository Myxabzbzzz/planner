import { describe, expect, it } from "vitest";
import { buildAgenda, dayProgress, taskTime } from "./agenda";
import type { Today } from "./types";

const ev = (id: string, time: string, done = false): Today["events"][number] =>
  ({ id, title: `встреча ${id}`, time, date: "2026-10-07", with_whom: null, done });
const tk = (id: string, due: string, overdue = false): Today["tasks"][number] =>
  ({ id, title: `задача ${id}`, due, overdue });

describe("время задачи", () => {
  it("23:59 значит «в течение дня», а не «к полуночи»", () => {
    expect(taskTime("2026-10-07T23:59")).toBeNull();
  });

  it("настоящее время отдаётся как есть", () => {
    expect(taskTime("2026-10-07T14:00")).toBe("14:00");
  });

  it("срок без времени не ломается", () => {
    expect(taskTime("2026-10-07")).toBeNull();
  });
});

describe("лента дня", () => {
  it("смешивает встречи и задачи по времени", () => {
    const rows = buildAgenda({
      events: [ev("e1", "10:30"), ev("e2", "19:30")],
      tasks: [tk("t1", "2026-10-07T14:00")],
    });
    expect(rows.map((r) => [r.kind, r.at])).toEqual([
      ["event", "10:30"],
      ["task", "14:00"],
      ["event", "19:30"],
    ]);
  });

  it("задачи без времени уходят в конец, сохраняя порядок сервера", () => {
    const rows = buildAgenda({
      events: [ev("e1", "09:00")],
      tasks: [tk("t1", "2026-10-07T23:59"), tk("t2", "2026-10-07T23:59"), tk("t3", "2026-10-07T08:00")],
    });
    expect(rows.map((r) => r.key)).toEqual(["t:t3", "e:e1", "t:t1", "t:t2"]);
  });

  it("при одинаковом времени порядок стабилен", () => {
    const rows = buildAgenda({ events: [ev("a", "12:00"), ev("b", "12:00")], tasks: [] });
    expect(rows.map((r) => r.key)).toEqual(["e:a", "e:b"]);
  });

  it("пустой день — пустая лента", () => {
    expect(buildAgenda({ events: [], tasks: [] })).toEqual([]);
  });
});

describe("прогресс дня", () => {
  const data = {
    events: [ev("e1", "10:00", true), ev("e2", "11:00")],
    tasks: [tk("t1", "2026-10-07T23:59")],
    habits: [{ id: "h1", name: "Зарядка", done: true }, { id: "h2", name: "Зал", done: false }],
  };

  it("считает всё сегодняшнее вместе", () => {
    expect(dayProgress(data, {})).toEqual({ done: 2, total: 5 });
  });

  it("оптимистичная отметка учитывается сразу", () => {
    expect(dayProgress(data, { "t:t1": true, "h:h2": true })).toEqual({ done: 4, total: 5 });
  });

  it("снятая отметка тоже учитывается", () => {
    expect(dayProgress(data, { "e:e1": false })).toEqual({ done: 1, total: 5 });
  });

  it("пустой день не делит на ноль", () => {
    expect(dayProgress({ events: [], tasks: [], habits: [] }, {})).toEqual({ done: 0, total: 0 });
  });
});
