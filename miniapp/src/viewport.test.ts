import { describe, expect, it } from "vitest";
import { keyboardInset } from "./viewport";

describe("отступ под клавиатуру", () => {
  it("клавиатура открыта — док поднимается на её высоту", () => {
    expect(keyboardInset(844, 508, 0, true)).toBe(336);
  });

  it("iOS прокрутил видимую область вверх — это не клавиатура", () => {
    expect(keyboardInset(844, 508, 120, true)).toBe(216);
  });

  it("резиновый отскок без поля ввода не двигает док", () => {
    expect(keyboardInset(844, 844, -150, false)).toBe(0);
  });

  it("отрицательный offsetTop не добавляется к высоте", () => {
    expect(keyboardInset(844, 508, -150, true)).toBe(336);
  });
});
