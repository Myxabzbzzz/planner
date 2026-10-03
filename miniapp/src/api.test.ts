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
});
