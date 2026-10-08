export type Me = { name: string; tz: string; base_currency: string };
export type Today = {
  base_currency: string;
  events: { id: string; title: string; time: string; date: string; with_whom: string | null; done: boolean }[];
  tasks: { id: string; title: string; due: string; overdue: boolean; due_has_time?: boolean }[];
  tasks_more: number;
  spent_today: number;
  month_spent: number;
  limit: number | null;
  habits: { id: string; name: string; done: boolean }[];
};
export type TaskItem = {
  id: string; title: string; due: string | null; overdue: boolean; done_at: string | null;
  /** Новая схема отдаёт флаг явно; у старой его нет — тогда работает запасной разбор по 23:59. */
  due_has_time?: boolean;
};
/** `total` — сколько задач под фильтром всего; список обрезан сотней. */
export type TasksResp = { tasks: TaskItem[]; total?: number };
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
  /** Сколько операций в месяце всего и курсор на продолжение, если список обрезан. */
  operations_total?: number;
  operations_next_before?: string | null;
};
export type HabitDay = { date: string; done: boolean };
export type Habit = {
  id: string; name: string; target_per_week: number; days: HabitDay[]; streak: number; done_today: boolean;
};
export type HabitsResp = { habits: Habit[] };
export type Note = { id: string; kind: "thought" | "journal"; text: string; created_at: string };
export type NotesResp = { notes: Note[]; next_before: string | null };
export type Category = { id: string; name: string };
export type Categories = { expense: Category[]; income: Category[] };
export type Sent = { id: string; worker_online: boolean };
export type InboxStatus = { status: "pending" | "processing" | "done" | "failed" | "needs_review"; reply: string | null };
export type Created = { id: string };

export type Settings = {
  name: string;
  tz: string;
  base_currency: string;
  limit: number | null;
  notify_reminders: boolean;
  notify_daily: boolean;
  notify_weekly: boolean;
};
export type NotifyKind = "reminders" | "daily" | "weekly";

/** Профиль отдаёт только факты — уровень и награды считает `gamify.ts`. */
export type Profile = {
  name: string;
  tz: string;
  base_currency: string;
  since: string;
  days_known: number;
  active_days: number;
  active_streak: number;
  tasks: { open: number; overdue: number; done_total: number; done_30d: number; created_30d: number };
  events: { total: number; done_total: number; next_7d: number };
  habits: { active: number; best_streak: number; logs_total: number; week_done: number; week_target: number };
  notes: { total: number; thoughts: number; journals: number; d30: number };
  captures: { total: number; done: number; needs_review: number; failed: number };
  money: { limit: number | null; months: { month: string; expense: number; income: number }[] };
  weeks: { week: string; done: number; created: number }[];
  heat: { date: string; done: number }[];
  heat_total: number;
};

export type OperationsResp = { operations: Operation[]; next_before: string | null };

export type Budget = { name: string; limit: number | null; spent: number };
export type BudgetsResp = {
  base_currency: string;
  overall: { limit: number | null; spent: number };
  categories: Budget[];
};

/** Открытый вопрос ИИ: раньше ответить на него можно было только в чате. */
export type ReviewOption = { key: string; label: string; kind: ReviewKind };
/** «type» — что это за запись, «time» — во сколько; у них разные RPC. */
export type ReviewKind = "type" | "time";
export type Review = {
  inbox_id: string;
  index: number;
  question: string;
  source_text: string;
  options: ReviewOption[];
  created_at: string;
};
export type ReviewsResp = { reviews: Review[] };

export type CurrencyChange = { converted: number; skipped: number; from: string; to: string };
