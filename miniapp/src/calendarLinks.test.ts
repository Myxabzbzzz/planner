import { describe, expect, it } from "vitest";
import { googleSubscribe, webcal } from "./calendarLinks";

describe("подписка на календарь", () => {
  it("webcal и ссылка Google", () => {
    const url = "https://p.supabase.co/functions/v1/calendar/abc.ics";
    expect(webcal(url)).toBe("webcal://p.supabase.co/functions/v1/calendar/abc.ics");
    expect(googleSubscribe(url)).toBe(
      "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fp.supabase.co%2Ffunctions%2Fv1%2Fcalendar%2Fabc.ics");
  });
});
