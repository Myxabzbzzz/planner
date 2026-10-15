import { describe, expect, it } from "vitest";
import { REPEAT_CHOICES, repeatLabel } from "./repeat";

describe("повтор", () => {
  it("подписи правил", () => {
    expect(repeatLabel("weekdays")).toBe("по будням");
    expect(REPEAT_CHOICES.map((c) => c.label)).toEqual(["Нет", "Каждый день", "По будням", "Каждую неделю", "Каждый месяц"]);
  });
});
