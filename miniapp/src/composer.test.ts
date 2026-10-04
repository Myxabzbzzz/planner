import { describe, expect, it } from "vitest";
import { GIVE_UP_MS, LATE, outcomeFor, validText, waitForOutcome, waitingText } from "./composer";
import type { InboxStatus } from "./types";

function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe("validText", () => {
  it("accepts 1..4000 chars after trim", () => {
    expect(validText(" кофе ")).toBe(true);
    expect(validText("   ")).toBe(false);
    expect(validText("x".repeat(4001))).toBe(false);
  });
});

describe("waitingText", () => {
  it("depends on the worker", () => {
    expect(waitingText(true)).toBe("⏳ Разбираю…");
    expect(waitingText(false)).toBe("⏳ Принял, разберу, когда ИИ проснётся");
  });
});

describe("outcomeFor", () => {
  it("maps terminal statuses", () => {
    expect(outcomeFor({ status: "done", reply: "✅ Записал: x" })).toEqual({ tone: "ok", text: "✅ Записал: x" });
    expect(outcomeFor({ status: "needs_review", reply: "❓ Уточни 1 — ниже." })).toEqual({ tone: "review", text: "❓ Нужно уточнить — открой чат" });
    expect(outcomeFor({ status: "failed", reply: null })).toEqual({ tone: "error", text: "😵 Не получилось разобрать. Попробуй ещё раз." });
    expect(outcomeFor({ status: "failed", reply: "🙉 Не расслышал. Повтори, пожалуйста." })?.text).toBe("🙉 Не расслышал. Повтори, пожалуйста.");
    expect(outcomeFor({ status: "processing", reply: null })).toBeNull();
  });
});

describe("waitForOutcome", () => {
  it("polls until a terminal status", async () => {
    const seq: InboxStatus[] = [{ status: "pending", reply: null }, { status: "done", reply: "✅" }];
    const c = clock();
    const got = await waitForOutcome(async () => seq.shift()!, "i1", { ...c, alive: () => true });
    expect(got).toEqual({ tone: "ok", text: "✅" });
    expect(c.now()).toBe(4000);
  });
  it("keeps polling after a failed request", async () => {
    let n = 0;
    const got = await waitForOutcome(async () => {
      n += 1;
      if (n === 1) throw new Error("net");
      return { status: "done", reply: "✅" };
    }, "i1", { ...clock(), alive: () => true });
    expect(got?.tone).toBe("ok");
  });
  it("gives up after 3 minutes", async () => {
    const c = clock();
    const got = await waitForOutcome(async () => ({ status: "pending", reply: null }), "i1", { ...c, alive: () => true });
    expect(got).toEqual(LATE);
    expect(c.now()).toBe(GIVE_UP_MS);
  });
  it("stops when the screen is gone", async () => {
    let alive = true;
    const got = await waitForOutcome(async () => { alive = false; return { status: "pending", reply: null }; }, "i1",
      { ...clock(), alive: () => alive });
    expect(got).toBeNull();
  });
});
