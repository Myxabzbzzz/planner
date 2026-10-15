import { describe, expect, it } from "vitest";
import { rescuableDay } from "./habitFreeze";

const d = (date: string, done: boolean, frozen = false) => ({ date, done, frozen });

describe("спасти серию", () => {
  it("вчера пропуск после отмеченного дня — можно заморозить вчера", () => {
    expect(rescuableDay([d("2026-10-12", true), d("2026-10-13", true), d("2026-10-14", false), d("2026-10-15", false)]))
      .toBe("2026-10-14");
  });
  it("цепочка через уже замороженный день тоже спасается", () => {
    expect(rescuableDay([d("2026-10-13", false, true), d("2026-10-14", false), d("2026-10-15", true)])).toBe("2026-10-14");
  });
  it("вчера отмечено или заморожено, или серии и не было — нечего спасать", () => {
    expect(rescuableDay([d("2026-10-13", true), d("2026-10-14", true), d("2026-10-15", false)])).toBeNull();
    expect(rescuableDay([d("2026-10-13", true), d("2026-10-14", false, true), d("2026-10-15", false)])).toBeNull();
    expect(rescuableDay([d("2026-10-13", false), d("2026-10-14", false), d("2026-10-15", false)])).toBeNull();
  });
});
