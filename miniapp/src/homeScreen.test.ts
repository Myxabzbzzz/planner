import { describe, expect, it } from "vitest";
import { offerHomeScreen } from "./homeScreen";

describe("home screen icon", () => {
  it("is offered only when it can be added and is not there yet", () => {
    expect(offerHomeScreen("missed")).toBe(true);
    expect(offerHomeScreen("unknown")).toBe(true);
    expect(offerHomeScreen("added")).toBe(false);
    expect(offerHomeScreen("unsupported")).toBe(false);
  });
});
