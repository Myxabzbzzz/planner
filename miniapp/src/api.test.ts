import { describe, expect, it } from "vitest";
import { ApiError, makeApi } from "./api";

describe("api client", () => {
  it("sends X-Init-Data and query params", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchFn = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = makeApi("https://x/functions/v1/api/", "INIT", fetchFn);
    await api.money("2026-10");
    await api.notes("", undefined);
    expect(seen[0].url).toBe("https://x/functions/v1/api/money?month=2026-10");
    expect(seen[0].headers["X-Init-Data"]).toBe("INIT");
    expect(seen[1].url).toBe("https://x/functions/v1/api/notes");
  });
  it("throws ApiError with status", async () => {
    const fetchFn = (async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(makeApi("https://x", "I", fetchFn).today()).rejects.toMatchObject({ status: 403 });
    await expect(makeApi("https://x", "I", fetchFn).today()).rejects.toBeInstanceOf(ApiError);
  });
  it("posts marks with method, body and init data", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: URL, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = makeApi("https://x/api", "INIT", fetchFn);
    await api.setTaskDone("t1", true);
    await api.setHabitToday("h1", false);
    expect(seen[0].url).toBe("https://x/api/tasks/t1/done");
    expect(seen[0].init.method).toBe("POST");
    expect(seen[0].init.body).toBe(JSON.stringify({ done: true }));
    expect((seen[0].init.headers as Record<string, string>)["X-Init-Data"]).toBe("INIT");
    expect(seen[1].url).toBe("https://x/api/habits/h1/today");
  });

  it("edits and deletes transactions and loads categories", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchFn = (async (url: URL, init?: RequestInit) => {
      seen.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, expense: [], income: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = makeApi("https://x/api", "INIT", fetchFn);
    await api.updateTransaction("t1", { amount: 200 });
    await api.deleteTransaction("t1");
    await api.categories();
    expect(seen.map((s) => [s.url, s.init?.method ?? "GET", s.init?.body])).toEqual([
      ["https://x/api/transactions/t1", "POST", JSON.stringify({ amount: 200 })],
      ["https://x/api/transactions/t1/delete", "POST", "{}"],
      ["https://x/api/categories", "GET", undefined],
    ]);
  });
});

describe("edit endpoints", () => {
  it("posts patches and deletes to item routes", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
      calls.push([String(u), init]);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const api = makeApi("https://x/api", "init", f);
    await api.updateTask("t1", { due_date: null });
    await api.deleteEvent("e1");
    await api.updateNote("n1", { kind: "journal" });
    await api.archiveHabit("h1");
    expect(calls.map(([u, i]) => [u, i?.body])).toEqual([
      ["https://x/api/tasks/t1", '{"due_date":null}'],
      ["https://x/api/events/e1/delete", "{}"],
      ["https://x/api/notes/n1", '{"kind":"journal"}'],
      ["https://x/api/habits/h1/archive", "{}"],
    ]);
  });
});

describe("inbox endpoints", () => {
  it("sends text and reads status", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = (async (u: URL | RequestInfo, init?: RequestInit) => {
      calls.push([String(u), init]);
      return new Response(JSON.stringify(String(u).endsWith("/inbox") ? { id: "i1", worker_online: true } : { status: "done", reply: "✅" }), { status: 200 });
    }) as typeof fetch;
    const api = makeApi("https://x/api", "init", f);
    expect(await api.sendText("кофе")).toEqual({ id: "i1", worker_online: true });
    expect(await api.inboxStatus("i1")).toEqual({ status: "done", reply: "✅" });
    expect(calls[0][1]?.method).toBe("POST");
    expect(calls[0][1]?.body).toBe('{"text":"кофе"}');
    expect(calls[1][0]).toBe("https://x/api/inbox/i1");
  });
});
