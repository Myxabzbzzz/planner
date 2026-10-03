import { describe, expect, it } from "vitest";
import { buildPatch, editableAmount, parseAmount } from "./opEdit";
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
