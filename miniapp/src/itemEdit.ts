export const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type NoteKind = "thought" | "journal";
export type TaskForm = { title: string; date: string; time: string };
export type TaskPatch = { title?: string; due_date?: string | null; due_time?: string | null };
export type EventForm = { title: string; date: string; time: string; withWhom: string };
export type EventPatch = { title?: string; date?: string; time?: string; with_whom?: string };
export type NoteForm = { text: string; kind: NoteKind };
export type NotePatch = { text?: string; kind?: NoteKind };
export type HabitForm = { name: string; target: number };
export type HabitPatch = { name?: string; target?: number };

type Result<P> = P | null | "invalid";

const okTitle = (s: string) => s !== "" && s.length <= 200;
const done = <P extends object>(p: P): Result<P> => (Object.keys(p).length ? p : null);

/** Срок задачи из API «YYYY-MM-DDTHH:MM». Флаг важнее старого хака с 23:59. */
export function splitDue(due: string | null, hasTime?: boolean): { date: string; time: string } {
  if (!due) return { date: "", time: "" };
  const [date, time] = due.split("T");
  if (hasTime !== undefined) return { date, time: hasTime ? (time ?? "") : "" };
  return { date, time: time === "23:59" ? "" : time };
}

export function buildTaskPatch(t: { title: string; due: string | null }, f: TaskForm): Result<TaskPatch> {
  const title = f.title.trim();
  if (!okTitle(title)) return "invalid";
  if (f.date && !DATE.test(f.date)) return "invalid";
  if (f.time && (!f.date || !TIME.test(f.time))) return "invalid";
  const was = splitDue(t.due);
  const p: TaskPatch = {};
  if (title !== t.title) p.title = title;
  if (f.date !== was.date || f.time !== was.time) {
    if (!f.date) p.due_date = null;
    else Object.assign(p, { due_date: f.date, due_time: f.time || null });
  }
  return done(p);
}

export function buildEventPatch(
  e: { title: string; date: string; time: string; with_whom: string | null }, f: EventForm,
): Result<EventPatch> {
  const title = f.title.trim();
  const who = f.withWhom.trim();
  if (!okTitle(title) || !DATE.test(f.date) || !TIME.test(f.time) || who.length > 200) return "invalid";
  const p: EventPatch = {};
  if (title !== e.title) p.title = title;
  if (f.date !== e.date) p.date = f.date;
  if (f.time !== e.time) p.time = f.time;
  if (who !== (e.with_whom ?? "")) p.with_whom = who;
  return done(p);
}

export function buildNotePatch(n: { text: string; kind: NoteKind }, f: NoteForm): Result<NotePatch> {
  const text = f.text.trim();
  if (text === "" || text.length > 4000) return "invalid";
  const p: NotePatch = {};
  if (text !== n.text) p.text = text;
  if (f.kind !== n.kind) p.kind = f.kind;
  return done(p);
}

export function buildHabitPatch(h: { name: string; target_per_week: number }, f: HabitForm): Result<HabitPatch> {
  const name = f.name.trim();
  if (!okTitle(name) || !Number.isInteger(f.target) || f.target < 1 || f.target > 7) return "invalid";
  const p: HabitPatch = {};
  if (name !== h.name) p.name = name;
  if (f.target !== h.target_per_week) p.target = f.target;
  return done(p);
}
