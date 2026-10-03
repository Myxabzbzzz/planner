import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { screenForState } from "./state";

describe("screenForState", () => {
  it("chooses the right screen", () => {
    expect(screenForState({ initData: "", error: null })).toBe("outside");
    expect(screenForState({ initData: "x", error: new ApiError(401) })).toBe("relaunch");
    expect(screenForState({ initData: "x", error: new ApiError(403) })).toBe("noaccess");
    expect(screenForState({ initData: "x", error: new Error("net") })).toBe("network");
    expect(screenForState({ initData: "x", error: null })).toBe("ok");
  });
});
