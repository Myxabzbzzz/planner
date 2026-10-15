import { assert, assertEquals } from "jsr:@std/assert@1";
import { handleCalendar } from "./handler.ts";
import { buildIcs, esc, type Feed, fold } from "./ics.ts";

const TOKEN = "a".repeat(48);
const NOW = new Date("2026-10-15T08:00:00Z");
const FEED: Feed = {
  pro: true, tz: "Europe/Moscow",
  events: [{ id: "e1", title: "Созвон, по ремонту; срочно", with_whom: "Андрей", done: false,
             starts_at: "20261016T070000Z", ends_at: "20261016T080000Z" }],
  tasks: [
    { id: "t1", title: "Купить хлеб", has_time: false, date: "20261017", next_date: "20261018",
      due_at: "20261017T205900Z", due_end: "20261017T211400Z" },
    { id: "t2", title: "Отправить договор", has_time: true, date: "20261017", next_date: "20261018",
      due_at: "20261017T110000Z", due_end: "20261017T111500Z" },
  ],
};

const db = (feed: Feed | null) => ({ feed: async (t: string) => (t === TOKEN ? feed : null) });

Deno.test("лента: встречи со временем, дела без времени — на весь день, текст экранирован", async () => {
  const res = await handleCalendar(new Request(`https://x/functions/v1/calendar/${TOKEN}.ics`), db(FEED), NOW, "https://app/");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  const ics = await res.text();
  assert(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert(ics.includes("UID:e1@bt-planner\r\n"));
  assert(ics.includes("DTSTART:20261016T070000Z\r\nDTEND:20261016T080000Z\r\n"));
  assert(ics.includes("SUMMARY:Созвон\\, по ремонту\; срочно\r\n"));
  assert(ics.includes("DESCRIPTION:С кем: Андрей\r\n"));
  assert(ics.includes("DTSTART;VALUE=DATE:20261017\r\nDTEND;VALUE=DATE:20261018\r\nSUMMARY:☑️ Купить хлеб"));
  assert(ics.includes("DTSTART:20261017T110000Z\r\nDTEND:20261017T111500Z\r\nSUMMARY:☑️ Отправить договор"));
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 3);
});

Deno.test("без Pro — одна понятная запись вместо встреч", () => {
  const ics = buildIcs({ ...FEED, pro: false }, NOW);
  assertEquals(ics.match(/BEGIN:VEVENT/g)!.length, 1);
  assert(ics.includes("календарь — функция Pro"));
  assert(!ics.includes("Созвон"));
});

Deno.test("чужой или кривой токен — 404, POST — 405", async () => {
  assertEquals((await handleCalendar(new Request(`https://x/calendar/${"b".repeat(48)}.ics`), db(FEED), NOW)).status, 404);
  assertEquals((await handleCalendar(new Request("https://x/calendar/short.ics"), db(FEED), NOW)).status, 404);
  assertEquals((await handleCalendar(new Request(`https://x/calendar/${TOKEN}.ics`, { method: "POST" }), db(FEED), NOW)).status, 405);
});

Deno.test("длинные строки переносятся по 75 байт, не разрывая буквы", () => {
  const line = "SUMMARY:" + "ж".repeat(60);
  const folded = fold(line);
  for (const part of folded.split("\r\n")) assert(new TextEncoder().encode(part).length <= 75);
  assertEquals(folded.replace(/\r\n /g, ""), line);
  assertEquals(esc("a\\b\nc"), "a\\\\b\\nc");
});
