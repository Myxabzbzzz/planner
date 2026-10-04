import type { InboxStatus } from "./types";

export const POLL_MS = 2000;
export const GIVE_UP_MS = 180_000;
export const MAX_TEXT = 4000;

export type Outcome = { tone: "ok" | "review" | "error" | "late"; text: string };
export const LATE: Outcome = { tone: "late", text: "⏳ Разберу, когда ИИ проснётся — сводка придёт в чат" };

export function validText(t: string): boolean {
  const s = t.trim();
  return s.length > 0 && s.length <= MAX_TEXT;
}

export const waitingText = (online: boolean) => (online ? "⏳ Разбираю…" : "⏳ Принял, разберу, когда ИИ проснётся");

export function outcomeFor(s: InboxStatus): Outcome | null {
  if (s.status === "done") return { tone: "ok", text: s.reply ?? "✅ Готово" };
  if (s.status === "needs_review") return { tone: "review", text: "❓ Нужно уточнить — открой чат" };
  if (s.status === "failed") return { tone: "error", text: s.reply ?? "😵 Не получилось разобрать. Попробуй ещё раз." };
  return null;
}

type Deps = { now: () => number; sleep: (ms: number) => Promise<void>; alive: () => boolean };

/** Опрашивает статус, пока экран жив; сетевые ошибки — тихий повтор; через 3 минуты — LATE. */
export async function waitForOutcome(get: (id: string) => Promise<InboxStatus>, id: string, deps: Deps): Promise<Outcome | null> {
  const start = deps.now();
  while (deps.alive()) {
    await deps.sleep(POLL_MS);
    if (!deps.alive()) return null;
    try {
      const o = outcomeFor(await get(id));
      if (o) return o;
    } catch {
      // следующий тик
    }
    if (!deps.alive()) return null;
    if (deps.now() - start >= GIVE_UP_MS) return LATE;
  }
  return null;
}
