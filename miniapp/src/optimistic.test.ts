import { describe, expect, it } from "vitest";
import { optimisticToggle } from "./optimistic";

describe("optimisticToggle", () => {
  it("applies new value and keeps it on success", async () => {
    const applied: boolean[] = [];
    const fx: string[] = [];
    const ok = await optimisticToggle(false, (v) => applied.push(v), async () => {}, (r) => fx.push(r ? "ok" : "fail"));
    expect(ok).toBe(true);
    expect(applied).toEqual([true]);
    expect(fx).toEqual(["ok"]);
  });
  it("reverts on failure", async () => {
    const applied: boolean[] = [];
    const fx: string[] = [];
    const ok = await optimisticToggle(true, (v) => applied.push(v), async () => { throw new Error("net"); },
      (r) => fx.push(r ? "ok" : "fail"));
    expect(ok).toBe(false);
    expect(applied).toEqual([false, true]);
    expect(fx).toEqual(["fail"]);
  });
});
