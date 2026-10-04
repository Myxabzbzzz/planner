export type Me = { name: string; tz: string; base_currency: string };
export type Today = {
  base_currency: string;
  events: { id: string; title: string; time: string; date: string; with_whom: string | null; done: boolean }[];
  tasks: { id: string; title: string; due: string; overdue: boolean }[];
  tasks_more: number;
  spent_today: number;
  month_spent: number;
  limit: number | null;
  habits: { id: string; name: string; done: boolean }[];
};
export type TaskItem = { id: string; title: string; due: string | null; overdue: boolean; done_at: string | null };
export type TasksResp = { tasks: TaskItem[] };
export type EventItem = { id: string; title: string; time: string; with_whom: string | null; done: boolean };
export type EventsResp = { days: { date: string; events: EventItem[] }[] };
export type Operation = {
  id: string; date: string; type: "expense" | "income"; title: string; amount: number; category: string;
  orig: { amount: number; currency: string; rate: number; rate_date: string } | null;
};
export type MoneyResp = {
  base_currency: string; month: string; expense: number; income: number; limit: number | null;
  by_category: { name: string; amount: number }[];
  by_day: { date: string; expense: number }[];
  operations: Operation[];
};
export type HabitDay = { date: string; done: boolean };
export type HabitsResp = { habits: { id: string; name: string; target_per_week: number; days: HabitDay[]; streak: number; done_today: boolean }[] };
export type Note = { id: string; kind: "thought" | "journal"; text: string; created_at: string };
export type NotesResp = { notes: Note[]; next_before: string | null };
export type Categories = { expense: string[]; income: string[] };
export type Sent = { id: string; worker_online: boolean };
export type InboxStatus = { status: "pending" | "processing" | "done" | "failed" | "needs_review"; reply: string | null };
