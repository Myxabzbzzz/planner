import type { EventPatch, HabitPatch, NotePatch, TaskPatch } from "./itemEdit";
import type { OpEdit, OpPatch } from "./opEdit";
import { baseMime } from "./recorder";
import { flattenReviews, type ReviewsWire } from "./reviews";
import type {
  BudgetsResp, Categories, Created, CurrencyChange, EventsResp, HabitsResp, InboxStatus, Me, MoneyResp, NotesResp,
  NotifyKind, OperationsResp, Profile, ReviewKind, ReviewsResp, Sent, Settings, SubPlan, Subscription, TasksResp, Today,
} from "./types";
import type { NewEvent, NewHabit, NewNote, NewTask, NewTransaction } from "./newItem";

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
  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetchFn(new URL(base + path), {
      method: "POST",
      headers: { "X-Init-Data": initData, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new ApiError(res.status);
    return (await res.json()) as T;
  }
  async function postFor<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
    const res = await fetchFn(new URL(base + path), {
      method: "POST",
      headers: { "X-Init-Data": initData, "content-type": contentType },
      body,
    });
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
    setTaskDone: (id: string, done: boolean) => post(`/tasks/${id}/done`, { done }),
    setEventDone: (id: string, done: boolean) => post(`/events/${id}/done`, { done }),
    setHabitToday: (id: string, done: boolean) => post(`/habits/${id}/today`, { done }),
    categories: () => get<Categories>("/categories"),
    updateTransaction: (id: string, patch: OpPatch) => post(`/transactions/${id}`, patch),
    deleteTransaction: (id: string) => post(`/transactions/${id}/delete`, {}),
    updateTask: (id: string, patch: TaskPatch) => post(`/tasks/${id}`, patch),
    deleteTask: (id: string) => post(`/tasks/${id}/delete`, {}),
    updateEvent: (id: string, patch: EventPatch) => post(`/events/${id}`, patch),
    deleteEvent: (id: string) => post(`/events/${id}/delete`, {}),
    updateNote: (id: string, patch: NotePatch) => post(`/notes/${id}`, patch),
    deleteNote: (id: string) => post(`/notes/${id}/delete`, {}),
    updateHabit: (id: string, patch: HabitPatch) => post(`/habits/${id}`, patch),
    archiveHabit: (id: string) => post(`/habits/${id}/archive`, {}),
    sendText: (text: string) => postFor<Sent>("/inbox", JSON.stringify({ text }), "application/json"),
    inboxStatus: (id: string) => get<InboxStatus>(`/inbox/${id}`),
    sendAudio: (blob: Blob) => postFor<Sent>("/inbox/audio", blob, baseMime(blob.type)),
    notes: (q?: string, before?: string) => get<NotesResp>("/notes", { q, before }),

    // Создание без ИИ: когда воркер спит, приложение всё равно работает.
    createTask: (body: NewTask) => postJson<Created>("/tasks", body),
    createEvent: (body: NewEvent) => postJson<Created>("/events", body),
    createNote: (body: NewNote) => postJson<Created>("/notes", body),
    createHabit: (body: NewHabit) => postJson<Created>("/habits", body),
    createTransaction: (body: NewTransaction) => postJson<Created>("/transactions", body),

    setHabitOn: (id: string, date: string, done: boolean) => post(`/habits/${id}/day`, { date, done }),
    unarchiveHabit: (id: string) => post(`/habits/${id}/unarchive`, {}),

    // Удаление теперь мягкое — вернуть запись можно, пока висит «Отменить».
    restoreTask: (id: string) => post(`/tasks/${id}/restore`, {}),
    restoreEvent: (id: string) => post(`/events/${id}/restore`, {}),
    restoreNote: (id: string) => post(`/notes/${id}/restore`, {}),
    restoreTransaction: (id: string) => post(`/transactions/${id}/restore`, {}),

    editTransaction: (id: string, patch: OpEdit) => post(`/transactions/${id}/edit`, patch),
    operations: (month: string, before?: string) => get<OperationsResp>("/operations", { month, before }),

    budgets: (month: string) => get<BudgetsResp>("/budgets", { month }),
    setCategoryLimit: (category: string, amount: number) => post("/settings/category-limit", { category, amount }),
    renameCategory: (id: string, name: string) => post(`/categories/${id}`, { name }),
    deleteCategory: (id: string) => post(`/categories/${id}/delete`, {}),

    reviews: async (): Promise<ReviewsResp> => flattenReviews(await get<ReviewsWire>("/reviews")),
    answerReview: (inboxId: string, index: number, choice: string, kind: ReviewKind) =>
      post(`/reviews/${inboxId}`, { index, choice, kind }),

    changeCurrency: (currency: string) => postJson<CurrencyChange>("/settings/currency", { currency }),
    exportData: () => get<unknown>("/account/export"),
    deleteAccount: () => post("/account/delete", {}),

    subscription: () => get<Subscription>("/subscription"),
    invoice: (plan: SubPlan["id"]) => postJson<{ url: string }>("/subscription/invoice", { plan }),

    profile: (months = 6) => get<Profile>("/profile", { months }),
    settings: () => get<Settings>("/settings"),
    setLimit: (amount: number) => post("/settings/limit", { amount }),
    setNotify: (kind: NotifyKind, on: boolean) => post("/settings/notify", { kind, on }),
  };
}

export type Api = ReturnType<typeof makeApi>;
