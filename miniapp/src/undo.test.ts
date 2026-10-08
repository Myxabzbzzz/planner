import { describe, expect, it } from "vitest";
import { nextOffer, runUndos } from "./undoQueue";

const ok = () => Promise.resolve();
const fail = () => Promise.reject(new Error("net"));

describe("undo offers", () => {
  it("a second delete while the bar is up keeps the first one undoable", () => {
    const a = nextOffer(null, 1, "Задача удалена", ok);
    const b = nextOffer(a, 2, "Заметка удалена", ok);
    expect(b.undos).toHaveLength(2);
    expect(b.text).toBe("Удалено записей: 2");
    expect(b.id).toBe(2);
  });

  it("a fresh offer starts clean", () => {
    expect(nextOffer(null, 3, "Операция удалена", ok)).toMatchObject({ id: 3, text: "Операция удалена" });
  });

  it("restores everything and returns only what failed", async () => {
    const left = await runUndos([ok, fail, ok]);
    expect(left).toHaveLength(1);
    expect(await runUndos([ok, ok])).toEqual([]);
  });
});
