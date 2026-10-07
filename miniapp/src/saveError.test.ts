import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { saveError } from "./saveError";

describe("текст ошибки сохранения", () => {
  it("401 — это устаревшая сессия, а не отказ в доступе", () => {
    expect(saveError(new ApiError(401))).toMatch(/Сессия устарела/);
  });

  it("403 отправляет к боту, а не предлагает повторить", () => {
    expect(saveError(new ApiError(403))).toMatch(/\/start/);
  });

  it("400 указывает на поля", () => {
    expect(saveError(new ApiError(400))).toMatch(/Проверь поля/);
  });

  it("429 просит подождать", () => {
    expect(saveError(new ApiError(429))).toMatch(/Слишком часто/);
  });

  it("любая 5xx — это сервер, а не пользователь", () => {
    expect(saveError(new ApiError(500))).toMatch(/Сервер не отвечает/);
    expect(saveError(new ApiError(503))).toMatch(/Сервер не отвечает/);
  });

  it("обрыв связи и всё непонятное — обычное «попробуй ещё раз»", () => {
    expect(saveError(new Error("network"))).toMatch(/Попробуй ещё раз/);
    expect(saveError(null)).toMatch(/Попробуй ещё раз/);
    expect(saveError(new ApiError(404))).toMatch(/Попробуй ещё раз/);
  });
});
