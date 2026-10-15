import type { EventPatch, HabitPatch, NotePatch, TaskPatch } from "./itemEdit";
import type { OpEdit, OpPatch } from "./opEdit";
import { baseMime } from "./recorder";
import { flattenReviews, type ReviewsWire } from "./reviews";
import type {
  BudgetsResp, Categories, CategoryColor, Created, CurrencyChange, EventsResp, HabitsResp, InboxStatus, Me, MoneyResp, NotesResp,
  NotifyKind, OperationsResp, Profile, ReviewKind, ReviewsResp, Sent, Settings, SubPlan, Subscription, TasksResp, Today,
} from "./types";
import type { NewEvent, NewHabit, NewNote, NewTask, NewTransaction } from "./newItem";

export class ApiError extends Error {
  constructor(public status: number) {
    super(`api ${status}`);
  }
}

/** Сервер ответил «это функция Pro» (402) — показываем, что даёт Pro, а не ошибку. */
export const needsPro = (e: unknown) => e instanceof ApiError && e.status === 402;

/** Где живёт токен сессии между перезапусками WebView. */
export type SessionStore = { get(): string | null; set(token: string | null): void };

const SESSION_KEY = "planner.session";

/**
 * localStorage, но без падений: в приватном режиме и с заблокированными данными
 * доступ к нему бросает — тогда токен живёт только в памяти до закрытия миниаппа.
 */
export function browserSessionStore(): SessionStore {
  let memory: string | null = null;
  return {
    get() {
      try {
        return globalThis.localStorage?.getItem(SESSION_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    set(token) {
      memory = token;
      try {
        if (token) globalThis.localStorage?.setItem(SESSION_KEY, token);
        else globalThis.localStorage?.removeItem(SESSION_KEY);
      } catch {
        // остаётся в памяти
      }
    },
  };
}

export function makeApi(
  baseUrl: string,
  initData: string,
  fetchFn: typeof fetch = fetch,
  session: SessionStore = browserSessionStore(),
) {
  const base = baseUrl.replace(/\/$/, "");
  /**
   * Каждый запрос несёт initData и токен сессии. initData свёрнутого миниаппа стареет,
   * а токен сервер продлевает — новый приходит в заголовке ответа.
   */
  async function send(url: URL, init: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) {
    const token = session.get();
    const res = await fetchFn(url, {
      ...init,
      headers: { "X-Init-Data": initData, ...(token ? { "X-Session": token } : {}), ...init.headers },
    });
    const next = res.headers?.get?.("x-session");
    if (next) session.set(next);
    else if (res.status === 401 && token) session.set(null); // протух или чужой — не слать его дальше
    if (!res.ok) throw new ApiError(res.status);
    return res;
  }
  async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    return (await (await send(url)).json()) as T;
  }
  async function post(path: string, body: unknown): Promise<void> {
    await send(new URL(base + path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async function postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await send(new URL(base + path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }
  async function postFor<T>(path: string, body: BodyInit, contentType: string): Promise<T> {
    const res = await send(new URL(base + path), { method: "POST", headers: { "content-type": contentType }, body });
    return (await res.json()) as T;
  }
  // Категории меняются редко, а нужны сразу при открытии шторки: без кэша форма операции
  // сначала рисовалась с одной категорией, а через полсекунды прыгала на полный список.
  let cats: Promise<Categories> | null = null;
  let catsReady: Categories | null = null;
  const loadCategories = () =>
    (cats ??= get<Categories>("/categories").then(
      (c) => (catsReady = c),
      (e) => {
        cats = null;
        throw e;
      },
    ));
  /** Правки, после которых список категорий мог измениться (своя категория создаётся на лету). */
  const dropCategories = <T>(p: Promise<T>) =>
    p.finally(() => {
      cats = null;
      catsReady = null;
    });

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
    categories: loadCategories,
    /** Уже загруженные категории — чтобы первая отрисовка шторки была сразу полной. */
    cachedCategories: () => catsReady,
    updateTransaction: (id: string, patch: OpPatch) => dropCategories(post(`/transactions/${id}`, patch)),
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
    createTransaction: (body: NewTransaction) => dropCategories(postJson<Created>("/transactions", body)),

    setHabitOn: (id: string, date: string, done: boolean) => post(`/habits/${id}/day`, { date, done }),
    unarchiveHabit: (id: string) => post(`/habits/${id}/unarchive`, {}),

    // Удаление теперь мягкое — вернуть запись можно, пока висит «Отменить».
    restoreTask: (id: string) => post(`/tasks/${id}/restore`, {}),
    restoreEvent: (id: string) => post(`/events/${id}/restore`, {}),
    restoreNote: (id: string) => post(`/notes/${id}/restore`, {}),
    restoreTransaction: (id: string) => post(`/transactions/${id}/restore`, {}),

    editTransaction: (id: string, patch: OpEdit) => dropCategories(post(`/transactions/${id}/edit`, patch)),
    operations: (month: string, before?: string) => get<OperationsResp>("/operations", { month, before }),

    budgets: (month: string) => get<BudgetsResp>("/budgets", { month }),
    setCategoryLimit: (category: string, amount: number) => post("/settings/category-limit", { category, amount }),
    renameCategory: (id: string, name: string) => dropCategories(post(`/categories/${id}`, { name })),
    deleteCategory: (id: string) => dropCategories(post(`/categories/${id}/delete`, {})),
    setCategoryColor: (id: string, color: CategoryColor | null) =>
      dropCategories(post(`/categories/${id}/color`, { color })),

    reviews: async (): Promise<ReviewsResp> => flattenReviews(await get<ReviewsWire>("/reviews")),
    answerReview: (inboxId: string, index: number, choice: string, kind: ReviewKind) =>
      post(`/reviews/${inboxId}`, { index, choice, kind }),

    changeCurrency: (currency: string) => postJson<CurrencyChange>("/settings/currency", { currency }),
    /** Файл приходит в чат с ботом: скачать из миниаппа внутри Telegram получается не везде. */
    sendExport: (format: "xlsx" | "json") => postJson<{ ok: true; name: string }>("/account/export/send", { format }),
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
