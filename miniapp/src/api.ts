import type { EventsResp, HabitsResp, Me, MoneyResp, NotesResp, TasksResp, Today } from "./types";

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
  return {
    me: () => get<Me>("/me"),
    today: () => get<Today>("/today"),
    tasks: (filter: string) => get<TasksResp>("/tasks", { filter }),
    events: (from: string, to: string) => get<EventsResp>("/events", { from, to }),
    money: (month: string) => get<MoneyResp>("/money", { month }),
    habits: (weeks = 4) => get<HabitsResp>("/habits", { weeks }),
    notes: (q?: string, before?: string) => get<NotesResp>("/notes", { q, before }),
  };
}

export type Api = ReturnType<typeof makeApi>;
