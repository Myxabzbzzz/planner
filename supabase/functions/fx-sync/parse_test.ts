import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { parseErApi } from "./parse.ts";

Deno.test("parses open.er-api payload", () => {
  const out = parseErApi({
    result: "success",
    base_code: "USD",
    time_last_update_unix: 1790812951,
    rates: { USD: 1, UZS: 11818.674758, RUB: 83.691177 },
  });
  assertEquals(out.date, "2026-10-01");
  assertEquals(out.rates.UZS, 11818.674758);
});

Deno.test("rejects error payload", () => {
  assertThrows(() => parseErApi({ result: "error", "error-type": "quota" }));
});

Deno.test("rejects non-USD base", () => {
  assertThrows(() => parseErApi({ result: "success", base_code: "EUR", time_last_update_unix: 1, rates: {} }));
});
