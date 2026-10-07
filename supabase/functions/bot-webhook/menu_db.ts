import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type TodaySummary = {
  base_currency: string;
  events: { id: string; title: string; time: string; done: boolean }[];
  tasks: { id: string; title: string; overdue: boolean }[];
  spent_today: number;
  month_spent: number;
  limit: number | null;
  tasks_more: number;
  habits: { id: string; name: string; done: boolean; target_per_week: number; week_done: number }[];
};
export type TasksSummary = { tasks: { id: string; title: string; due: string | null; overdue: boolean }[]; total: number };
export type MoneySummary = {
  base_currency: string;
  month: string;
  expense: number;
  income: number;
  by_category: { name: string; amount: number }[];
  limit: number | null;
};
export type HabitsSummary = {
  habits: {
    id: string;
    name: string;
    week: boolean[];
    streak: number;
    done_today: boolean;
    target_per_week: number;
    week_done: number;
  }[];
};
export type SettingsSummary = { tz: string; base_currency: string; limit: number | null; capture_token: string;
  notify_reminders: boolean; notify_daily: boolean; notify_weekly: boolean;
};

export interface MenuDb {
  workerOnline(): Promise<boolean>;
  requestShortcut(userId: string, chatId: number): Promise<void>;
  today(userId: string): Promise<TodaySummary>;
  tasks(userId: string): Promise<TasksSummary>;
  money(userId: string): Promise<MoneySummary>;
  habits(userId: string): Promise<HabitsSummary>;
  settings(userId: string): Promise<SettingsSummary>;
  completeTask(userId: string, itemId: string): Promise<boolean>;
  logHabit(userId: string, habitId: string): Promise<boolean>;
  setTz(userId: string, tz: string): Promise<boolean>;
  setLimit(userId: string, amount: number): Promise<void>;
  setPending(userId: string, action: "limit" | null): Promise<void>;
  rotateToken(userId: string): Promise<string>;
  setNotify(userId: string, kind: "reminders" | "daily" | "weekly", on: boolean): Promise<void>;
}

// deno-lint-ignore no-explicit-any
function check<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function supabaseMenuDb(sb: SupabaseClient): MenuDb {
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => check(await sb.rpc(fn, args)) as T;
  return {
    today: (u) => rpc("summary_today", { p_user: u }),
    tasks: (u) => rpc("summary_tasks", { p_user: u }),
    money: (u) => rpc("summary_money", { p_user: u }),
    habits: (u) => rpc("summary_habits", { p_user: u }),
    settings: (u) => rpc("summary_settings", { p_user: u }),
    completeTask: async (u, id) => (await rpc<boolean>("complete_task", { p_user: u, p_item: id })) === true,
    logHabit: async (u, id) => (await rpc<boolean>("log_habit", { p_user: u, p_habit: id })) === true,
    setTz: async (u, tz) => (await rpc<boolean>("set_tz", { p_user: u, p_tz: tz })) === true,
    setLimit: async (u, amount) => {
      await rpc("set_limit", { p_user: u, p_amount: amount });
    },
    setPending: async (u, action) => {
      check(await sb.from("users").update({ pending_action: action }).eq("id", u));
    },
    workerOnline: async () => (await rpc<boolean>("worker_online", {})) === true,
    requestShortcut: async (u, chatId) => {
      check(await sb.from("jobs").insert({ user_id: u, kind: "shortcut_file", chat_id: chatId }));
    },
    rotateToken: (u) => rpc<string>("rotate_capture_token", { p_user: u }),
    setNotify: async (u, kind, on) => {
      await rpc("set_notify", { p_user: u, p_kind: kind, p_on: on });
    },
  };
}
