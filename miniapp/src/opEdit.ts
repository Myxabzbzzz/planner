import type { Operation } from "./types";

/** «20 000», «200,5», «22.40» → число; мусор, ноль и больше двух знаков после запятой → null. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n < 1e13 ? n : null;
}

/** Что правит пользователь: у валютных операций — сумму в исходной валюте. */
export function editableAmount(op: Operation, base = "") {
  return op.orig ? { amount: op.orig.amount, currency: op.orig.currency } : { amount: op.amount, currency: base };
}

export type OpForm = { amount: string; title: string; category: string };
export type OpPatch = { amount?: number; title?: string; category?: string };

export function buildPatch(op: Operation, form: OpForm): OpPatch | null | "invalid" {
  const amount = parseAmount(form.amount);
  if (amount === null) return "invalid";
  const title = form.title.trim();
  if (title === "" && op.title !== "") return "invalid";
  if (title.length > 200) return "invalid";
  const patch: OpPatch = {};
  if (Math.abs(amount - editableAmount(op).amount) >= 0.005) patch.amount = amount;
  if (title !== op.title && title !== "") patch.title = title;
  if (form.category !== op.category) patch.category = form.category;
  return Object.keys(patch).length ? patch : null;
}
