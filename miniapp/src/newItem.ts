/**
 * Валидация форм создания. Те же правила, что на сервере, но ответ приходит
 * до запроса: кнопка «Добавить» неактивна, пока форма не годится.
 * Возвращаем либо готовое тело запроса, либо null — «ещё нельзя».
 */
import { DATE, TIME } from "./itemEdit";
import type { NoteKind } from "./itemEdit";
import { parseAmount } from "./opEdit";

export type NewTask = { title: string; due_date?: string; due_time?: string };
export type NewEvent = { title: string; date: string; time: string; with_whom?: string };
export type NewNote = { text: string; kind: NoteKind };
export type NewHabit = { name: string; target: number };
export type NewTransaction = {
  type: "expense" | "income"; amount: number; title?: string; category?: string; date?: string;
};

const title = (s: string) => {
  const t = s.trim();
  return t !== "" && t.length <= 200 ? t : null;
};

export function buildNewTask(f: { title: string; date: string; time: string }): NewTask | null {
  const t = title(f.title);
  if (t === null) return null;
  if (f.date === "") return { title: t };
  if (!DATE.test(f.date)) return null;
  if (f.time !== "" && !TIME.test(f.time)) return null;
  return f.time === "" ? { title: t, due_date: f.date } : { title: t, due_date: f.date, due_time: f.time };
}

export function buildNewEvent(f: { title: string; date: string; time: string; withWhom: string }): NewEvent | null {
  const t = title(f.title);
  const who = f.withWhom.trim();
  if (t === null || !DATE.test(f.date) || !TIME.test(f.time) || who.length > 200) return null;
  return who === "" ? { title: t, date: f.date, time: f.time } : { title: t, date: f.date, time: f.time, with_whom: who };
}

export function buildNewNote(f: { text: string; kind: NoteKind }): NewNote | null {
  const text = f.text.trim();
  if (text === "" || text.length > 4000) return null;
  return { text, kind: f.kind };
}

export function buildNewHabit(f: { name: string; target: number }): NewHabit | null {
  const n = title(f.name);
  if (n === null) return null;
  if (!Number.isInteger(f.target) || f.target < 1 || f.target > 7) return null;
  return { name: n, target: f.target };
}

export function buildNewTransaction(f: {
  type: "expense" | "income"; amount: string; title: string; category: string; date: string;
}): NewTransaction | null {
  const amount = parseAmount(f.amount);
  if (amount === null) return null;
  if (f.date !== "" && !DATE.test(f.date)) return null;
  const t = f.title.trim();
  if (t.length > 200) return null;
  const body: NewTransaction = { type: f.type, amount };
  if (t !== "") body.title = t;
  if (f.category !== "") body.category = f.category;
  if (f.date !== "") body.date = f.date;
  return body;
}
