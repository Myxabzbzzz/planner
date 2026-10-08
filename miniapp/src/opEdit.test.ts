import { describe, expect, it } from "vitest";
import { buildEdit, buildPatch, editableAmount, parseAmount } from "./opEdit";
import type { OpFullForm } from "./opEdit";
import type { Operation } from "./types";

const usd: Operation = { id: "1", date: "2026-10-02", type: "expense", title: "Ерунда", amount: 236260059.16, category: "другое",
  orig: { amount: 20000, currency: "USD", rate: 11813.0, rate_date: "2026-10-02" } };
const uzs: Operation = { id: "2", date: "2026-10-02", type: "expense", title: "Кофе", amount: 40000, category: "кафе", orig: null };

describe("parseAmount", () => {
  it("accepts spaces, comma and dot decimals", () => {
    expect(parseAmount("20 000")).toBe(20000);
    expect(parseAmount("200,5")).toBe(200.5);
    expect(parseAmount(" 22.40 ")).toBe(22.4);
    expect(parseAmount("1 000")).toBe(1000);
  });
  it("rejects junk, zero and more than 2 decimals", () => {
    for (const s of ["", "abc", "0", "-5", "1,234", "12.345", "1e5"]) expect(parseAmount(s)).toBeNull();
  });
});

describe("editableAmount", () => {
  it("is the original currency amount for foreign operations", () => {
    expect(editableAmount(usd)).toEqual({ amount: 20000, currency: "USD" });
    expect(editableAmount(uzs, "UZS")).toEqual({ amount: 40000, currency: "UZS" });
  });
});

describe("buildPatch", () => {
  it("returns only changed fields", () => {
    expect(buildPatch(usd, { amount: "200", title: "Ерунда", category: "другое" })).toEqual({ amount: 200 });
    expect(buildPatch(uzs, { amount: "40 000", title: " Латте ", category: "еда" })).toEqual({ title: "Латте", category: "еда" });
  });
  it("is null when nothing changed and 'invalid' on bad input", () => {
    expect(buildPatch(uzs, { amount: "40000", title: "Кофе", category: "кафе" })).toBeNull();
    expect(buildPatch(uzs, { amount: "abc", title: "Кофе", category: "кафе" })).toBe("invalid");
    expect(buildPatch(uzs, { amount: "40000", title: "  ", category: "кафе" })).toBe("invalid");
  });
  it("treats an empty title of an untitled operation as unchanged", () => {
    expect(buildPatch({ ...uzs, title: "" }, { amount: "40000", title: "", category: "кафе" })).toBeNull();
  });
});

describe("полная правка операции", () => {
  const base: Operation = {
    id: "o1", date: "2026-10-07", type: "expense", title: "Обед", amount: 1200,
    category: "Кафе и рестораны", orig: null,
  };
  const form = (over: Partial<OpFullForm> = {}): OpFullForm => ({
    amount: "1200", title: "Обед", category: "Кафе и рестораны", date: "2026-10-07",
    type: "expense", currency: "RUB", ...over,
  });

  it("без изменений патч пустой", () => {
    expect(buildEdit(base, "RUB", form())).toBeNull();
  });

  it("дату теперь можно исправить, не удаляя операцию", () => {
    expect(buildEdit(base, "RUB", form({ date: "2026-10-05" }))).toEqual({ date: "2026-10-05" });
  });

  it("расход можно превратить в доход", () => {
    expect(buildEdit(base, "RUB", form({ type: "income" }))).toEqual({ type: "income" });
  });

  it("смена валюты всегда уходит вместе с суммой — сервер пересчитает по курсу", () => {
    expect(buildEdit(base, "RUB", form({ currency: "UZS" }))).toEqual({ currency: "UZS", amount: 1200 });
  });

  it("у валютной операции правится исходная сумма, а не базовая", () => {
    const withOrig: Operation = {
      ...base, amount: 1086.4,
      orig: { amount: 11.99, currency: "USD", rate: 90.61, rate_date: "2026-10-06" },
    };
    // та же сумма в USD — изменений нет
    expect(buildEdit(withOrig, "RUB", form({ amount: "11,99", currency: "USD" }))).toBeNull();
    // другая сумма в той же валюте — только сумма
    expect(buildEdit(withOrig, "RUB", form({ amount: "12,99", currency: "USD" }))).toEqual({ amount: 12.99 });
  });

  it("несколько полей сразу собираются в один патч", () => {
    expect(buildEdit(base, "RUB", form({ date: "2026-10-01", type: "income", title: "Возврат" })))
      .toEqual({ date: "2026-10-01", type: "income", title: "Возврат" });
  });

  it("пустое название не уходит на сервер (он его отклонит), у операции без названия — не изменение", () => {
    expect(buildEdit(base, "RUB", form({ title: "  " }))).toBe("invalid");
    expect(buildEdit({ ...base, title: "" }, "RUB", form({ title: "" }))).toBeNull();
  });

  it("мусор не пропускается", () => {
    expect(buildEdit(base, "RUB", form({ amount: "абв" }))).toBe("invalid");
    expect(buildEdit(base, "RUB", form({ amount: "0" }))).toBe("invalid");
    expect(buildEdit(base, "RUB", form({ date: "07.10.2026" }))).toBe("invalid");
    expect(buildEdit(base, "RUB", form({ currency: "рубли" }))).toBe("invalid");
    expect(buildEdit(base, "RUB", form({ title: "я".repeat(201) }))).toBe("invalid");
  });
});
