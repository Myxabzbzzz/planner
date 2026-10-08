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

/**
 * Полная правка операции: раньше менялись только сумма, название и категория.
 * Записанную не тем числом операцию приходилось удалять и заводить заново,
 * а расход, который на самом деле доход, или сумму не в той валюте
 * («потратил 200 на обед» в Ташкенте — это 200 000 сум, а не 200) исправить
 * было нечем вообще.
 */
export type OpEdit = {
  amount?: number;
  title?: string;
  category?: string;
  date?: string;
  type?: "expense" | "income";
  currency?: string;
};

export type OpFullForm = {
  amount: string;
  title: string;
  category: string;
  date: string;
  type: "expense" | "income";
  currency: string;
};

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** `base` — базовая валюта пользователя, `was` — текущее состояние операции. */
export function buildEdit(
  op: Operation,
  base: string,
  form: OpFullForm,
): OpEdit | null | "invalid" {
  const amount = parseAmount(form.amount);
  if (amount === null) return "invalid";
  const title = form.title.trim();
  if (title === "" && op.title !== "") return "invalid";  // сервер пустое название отклонит
  if (title.length > 200) return "invalid";
  if (!DATE_RE.test(form.date)) return "invalid";
  if (!/^[A-Z]{3}$/.test(form.currency)) return "invalid";

  const wasCur = op.orig?.currency ?? base;
  const wasAmount = op.orig ? op.orig.amount : op.amount;

  const patch: OpEdit = {};
  // Валюта и сумма идут парой: сервер пересчитает базовую сумму по курсу дня.
  if (form.currency !== wasCur) {
    patch.currency = form.currency;
    patch.amount = amount;
  } else if (Math.abs(amount - wasAmount) >= 0.005) {
    patch.amount = amount;
  }
  if (title !== op.title) patch.title = title;
  if (form.category !== op.category) patch.category = form.category;
  if (form.date !== op.date) patch.date = form.date;
  if (form.type !== op.type) patch.type = form.type;
  return Object.keys(patch).length > 0 ? patch : null;
}
