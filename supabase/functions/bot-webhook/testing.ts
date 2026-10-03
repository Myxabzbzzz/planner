import type { HabitsSummary, MenuDb, MoneySummary, SettingsSummary, TasksSummary, TodaySummary } from "./menu_db.ts";

export const TASK_ID = "20000000-0000-0000-0000-000000000001";
export const HABIT_ID = "30000000-0000-0000-0000-000000000001";

export class FakeMenuDb implements MenuDb {
  online = true;
  jobs: number[] = [];
  async workerOnline() { return this.online; }
  async requestShortcut(_u: string, chatId: number) { this.jobs.push(chatId); }
  todayData: TodaySummary = {
    base_currency: "UZS", events: [], tasks: [], spent_today: 0, month_spent: 0, limit: null, tasks_more: 0,
    habits: [{ id: HABIT_ID, name: "зарядка", done: false }],
  };
  tasksData: TasksSummary = { tasks: [{ id: TASK_ID, title: "Оплатить интернет", due: null, overdue: false }], total: 1 };
  moneyData: MoneySummary = { base_currency: "UZS", month: "10.2026", expense: 0, income: 0, by_category: [], limit: null };
  habitsData: HabitsSummary = {
    habits: [{ id: HABIT_ID, name: "зарядка", week: [false, false, false, false, false, false, false], streak: 0, done_today: false }],
  };
  settingsData: SettingsSummary = {
    tz: "Asia/Tashkent", base_currency: "UZS", limit: null, capture_token: "a".repeat(64),
    notify_reminders: true, notify_daily: true, notify_weekly: true,
  };
  completed: string[] = [];
  logged: string[] = [];
  tzSet: string[] = [];
  limits: number[] = [];
  pending: Array<"limit" | null> = [];
  rotated = 0;

  async today() { return this.todayData; }
  async tasks() { return this.tasksData; }
  async money() { return this.moneyData; }
  async habits() { return this.habitsData; }
  async settings() { return this.settingsData; }
  async completeTask(_u: string, id: string) { this.completed.push(id); return id === TASK_ID; }
  async logHabit(_u: string, id: string) { this.logged.push(id); return id === HABIT_ID; }
  async setTz(_u: string, tz: string) { this.tzSet.push(tz); return true; }
  async setLimit(_u: string, amount: number) { this.limits.push(amount); }
  async setPending(_u: string, action: "limit" | null) { this.pending.push(action); }
  notifySet: Array<[string, boolean]> = [];
  async setNotify(_u: string, kind: "reminders" | "daily" | "weekly", on: boolean) {
    this.notifySet.push([kind, on]);
    this.settingsData = { ...this.settingsData, [`notify_${kind}`]: on };
  }
  async rotateToken() { this.rotated++; return "b".repeat(64); }
}
