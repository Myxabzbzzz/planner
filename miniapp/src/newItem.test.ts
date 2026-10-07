import { describe, expect, it } from "vitest";
import { buildNewEvent, buildNewHabit, buildNewNote, buildNewTask, buildNewTransaction } from "./newItem";

describe("новая задача", () => {
  it("достаточно названия", () => {
    expect(buildNewTask({ title: "Позвонить врачу", date: "", time: "" })).toEqual({ title: "Позвонить врачу" });
  });

  it("подрезает пробелы", () => {
    expect(buildNewTask({ title: "  Хлеб  ", date: "", time: "" })).toEqual({ title: "Хлеб" });
  });

  it("пустое название — нельзя отправить", () => {
    expect(buildNewTask({ title: "   ", date: "", time: "" })).toBeNull();
  });

  it("слишком длинное название — нельзя", () => {
    expect(buildNewTask({ title: "я".repeat(201), date: "", time: "" })).toBeNull();
    expect(buildNewTask({ title: "я".repeat(200), date: "", time: "" })).not.toBeNull();
  });

  it("дата без времени и дата со временем", () => {
    expect(buildNewTask({ title: "x", date: "2026-10-09", time: "" })).toEqual({ title: "x", due_date: "2026-10-09" });
    expect(buildNewTask({ title: "x", date: "2026-10-09", time: "09:30" }))
      .toEqual({ title: "x", due_date: "2026-10-09", due_time: "09:30" });
  });

  it("время без даты отбрасываем — срок без дня не имеет смысла", () => {
    expect(buildNewTask({ title: "x", date: "", time: "09:30" })).toEqual({ title: "x" });
  });

  it("мусор в дате или времени — нельзя", () => {
    expect(buildNewTask({ title: "x", date: "09.10.2026", time: "" })).toBeNull();
    expect(buildNewTask({ title: "x", date: "2026-10-09", time: "25:00" })).toBeNull();
  });
});

describe("новая встреча", () => {
  it("требует и дату, и время", () => {
    expect(buildNewEvent({ title: "Созвон", date: "2026-10-09", time: "14:00", withWhom: "" }))
      .toEqual({ title: "Созвон", date: "2026-10-09", time: "14:00" });
    expect(buildNewEvent({ title: "Созвон", date: "", time: "14:00", withWhom: "" })).toBeNull();
    expect(buildNewEvent({ title: "Созвон", date: "2026-10-09", time: "", withWhom: "" })).toBeNull();
  });

  it("«с кем» необязательно, но попадает в тело", () => {
    expect(buildNewEvent({ title: "Ужин", date: "2026-10-09", time: "19:30", withWhom: " Катя " }))
      .toEqual({ title: "Ужин", date: "2026-10-09", time: "19:30", with_whom: "Катя" });
  });

  it("слишком длинное «с кем» — нельзя", () => {
    expect(buildNewEvent({ title: "x", date: "2026-10-09", time: "10:00", withWhom: "к".repeat(201) })).toBeNull();
  });
});

describe("новая заметка", () => {
  it("мысль и дневник", () => {
    expect(buildNewNote({ text: " идея ", kind: "thought" })).toEqual({ text: "идея", kind: "thought" });
    expect(buildNewNote({ text: "день", kind: "journal" })).toEqual({ text: "день", kind: "journal" });
  });

  it("пустой текст и слишком длинный — нельзя", () => {
    expect(buildNewNote({ text: "  ", kind: "thought" })).toBeNull();
    expect(buildNewNote({ text: "a".repeat(4001), kind: "thought" })).toBeNull();
  });
});

describe("новая привычка", () => {
  it("название и цель 1…7", () => {
    expect(buildNewHabit({ name: "Зарядка", target: 5 })).toEqual({ name: "Зарядка", target: 5 });
    expect(buildNewHabit({ name: "Зарядка", target: 0 })).toBeNull();
    expect(buildNewHabit({ name: "Зарядка", target: 8 })).toBeNull();
    expect(buildNewHabit({ name: "Зарядка", target: 3.5 })).toBeNull();
    expect(buildNewHabit({ name: " ", target: 3 })).toBeNull();
  });
});

describe("новая операция", () => {
  it("минимум — тип и сумма", () => {
    expect(buildNewTransaction({ type: "expense", amount: "450", title: "", category: "", date: "" }))
      .toEqual({ type: "expense", amount: 450 });
  });

  it("понимает пробелы и запятую в сумме", () => {
    expect(buildNewTransaction({ type: "expense", amount: "20 000", title: "", category: "", date: "" })?.amount)
      .toBe(20000);
    expect(buildNewTransaction({ type: "expense", amount: "200,5", title: "", category: "", date: "" })?.amount)
      .toBe(200.5);
  });

  it("ноль, минус и мусор — нельзя", () => {
    for (const amount of ["0", "-5", "абв", "", "1.234"]) {
      expect(buildNewTransaction({ type: "expense", amount, title: "", category: "", date: "" })).toBeNull();
    }
  });

  it("название, категория и дата добавляются только если заданы", () => {
    expect(buildNewTransaction({ type: "income", amount: "1000", title: " Зарплата ", category: "Работа", date: "2026-10-01" }))
      .toEqual({ type: "income", amount: 1000, title: "Зарплата", category: "Работа", date: "2026-10-01" });
  });

  it("битая дата — нельзя", () => {
    expect(buildNewTransaction({ type: "expense", amount: "10", title: "", category: "", date: "2026-13-01" }))
      .toBeNull();
  });
});
