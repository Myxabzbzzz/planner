import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { screenForState } from "./state";

describe("выбор экрана", () => {
  it("без initData — значит открыли вне Telegram", () => {
    expect(screenForState({ initData: "", error: null })).toBe("outside");
  });

  it("401 — сессия устарела, 403 — нет доступа", () => {
    expect(screenForState({ initData: "x", error: new ApiError(401) })).toBe("relaunch");
    expect(screenForState({ initData: "x", error: new ApiError(403) })).toBe("noaccess");
  });

  it("ошибка сервера и обрыв связи — разные экраны", () => {
    expect(screenForState({ initData: "x", error: new ApiError(500) })).toBe("server");
    expect(screenForState({ initData: "x", error: new ApiError(503) })).toBe("server");
    expect(screenForState({ initData: "x", error: new Error("net") })).toBe("network");
  });

  it("прочие коды API остаются «нет связи» — показывать нечего конкретного", () => {
    expect(screenForState({ initData: "x", error: new ApiError(404) })).toBe("network");
  });

  it("без ошибки — обычный экран", () => {
    expect(screenForState({ initData: "x", error: null })).toBe("ok");
  });
});
