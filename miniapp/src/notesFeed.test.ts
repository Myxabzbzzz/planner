import { describe, expect, it } from "vitest";
import { makeNotesLoader, type NotesState } from "./notesFeed";
import type { NotesResp } from "./types";

function setup() {
  const pending: { q: string; before?: string; res: (r: NotesResp) => void; rej: () => void }[] = [];
  let last!: NotesState;
  const loader = makeNotesLoader(
    (q, before) => new Promise<NotesResp>((res, rej) => pending.push({ q, before, res, rej: () => rej(new Error("x")) })),
    (s) => { last = s; },
  );
  const page = (t: string, next: string | null): NotesResp => ({
    notes: [{ id: t, kind: "thought", text: t, created_at: "2026-01-01T00:00:00Z" }],
    next_before: next,
  });
  return { pending, loader, page, get: () => last };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("notes loader", () => {
  it("ignores stale search response", async () => {
    const t = setup();
    t.loader.search("a"); t.loader.search("ab");
    t.pending[1].res(t.page("ab", null)); await tick();
    t.pending[0].res(t.page("a", null)); await tick();
    expect(t.get().notes.map((n) => n.id)).toEqual(["ab"]);
  });
  it("drops in-flight more after new search", async () => {
    const t = setup();
    t.loader.search(""); t.pending[0].res(t.page("p1", "c1")); await tick();
    t.loader.more();
    t.loader.search("x");
    t.pending[2].res(t.page("x1", "cx")); await tick();
    t.pending[1].res(t.page("old", "cold")); await tick();
    expect(t.get().notes.map((n) => n.id)).toEqual(["x1"]);
    expect(t.get().next).toBe("cx");
  });
  it("keeps notes and sets error when more fails", async () => {
    const t = setup();
    t.loader.search(""); t.pending[0].res(t.page("p1", "c1")); await tick();
    t.loader.more(); t.pending[1].rej(); await tick();
    expect(t.get().notes).toHaveLength(1);
    expect(t.get().error).toBe(true);
    expect(t.get().loading).toBe(false);
  });
  it("more is a no-op when next is null", async () => {
    const t = setup();
    t.loader.search(""); t.pending[0].res(t.page("p1", null)); await tick();
    t.loader.more();
    expect(t.pending).toHaveLength(1);
  });
});
