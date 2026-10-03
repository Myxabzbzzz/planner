import type { OpPatch } from "./opEdit";
import type { Categories, EventsResp, HabitsResp, Me, MoneyResp, NotesResp, TasksResp, Today } from "./types";

export class ApiError extends Error {
  constructor(public status: number) {
    super(`api ${status}`);
  }
}

export function makeApi(baseUrl: string, initData: string, fetchFn: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/$/, "");
  async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const res = await fetchFn(url, { headers: { "X-Init-Data": initData } });
    if (!res.ok) throw new ApiError(res.status);
    return (await res.json()) as T;
  }
  async function post(path: string, body: unknown): Promise<void> {
    const res = await fetchFn(new URL(base + path), {
      method: "POST",
      headers: { "X-Init-Data": initData, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status);
  }
  return {
    me: () => get<Me>("/me"),
    today: () => get<Today>("/today"),
    tasks: (filter: string) => get<TasksResp>("/tasks", { filter }),
    events: (from: string, to: string) => get<EventsResp>("/events", { from, to }),
    money: (month: string) => get<MoneyResp>("/money", { month }),
    habits: (weeks = 4) => get<HabitsResp>("/habits", { weeks }),
    setTaskDone: (id: string, done: boolean) => post(`/tasks/${id}/done`, { done }),
    setEventDone: (id: string, done: boolean) => post(`/events/${id}/done`, { done }),
    setHabitToday: (id: string, done: boolean) => post(`/habits/${id}/today`, { done }),
    categories: () => get<Categories>("/categories"),
    updateTransaction: (id: string, patch: OpPatch) => post(`/transactions/${id}`, patch),
    deleteTransaction: (id: string) => post(`/transactions/${id}/delete`, {}),
    notes: (q?: string, before?: string) => get<NotesResp>("/notes", { q, before }),
  };
}

export type Api = ReturnType<typeof makeApi>;
