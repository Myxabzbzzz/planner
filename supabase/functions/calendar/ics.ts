/**
 * Лента календаря (RFC 5545): встречи и дела из планера. Календари iPhone и Google
 * подписываются на ссылку и сами перечитывают её.
 */

export type FeedEvent = { id: string; title: string; with_whom: string | null; done: boolean; starts_at: string; ends_at: string };
export type FeedTask = { id: string; title: string; has_time: boolean; date: string; next_date: string; due_at: string; due_end: string };
export type Feed = { pro: boolean; tz: string; events: FeedEvent[]; tasks: FeedTask[] };

const NAME = "B&T Planner";

/** Запятая, точка с запятой, обратный слэш и перевод строки в тексте экранируются. */
export const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Строка длиннее 75 байт переносится: CRLF и пробел. Режем по символам, не посреди UTF-8. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function buildIcs(feed: Feed, now: Date, appUrl?: string): string {
  const dtstamp = stamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//B&T Planner//RU",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${NAME}`,
    `X-WR-TIMEZONE:${feed.tz}`,
    // перечитывать раз в час — чаще календари всё равно не ходят
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const event = (uid: string, props: string[]) =>
    lines.push("BEGIN:VEVENT", `UID:${uid}@bt-planner`, `DTSTAMP:${dtstamp}`, ...props, "END:VEVENT");

  if (!feed.pro) {
    // без Pro не ошибка, а понятная запись: иначе календарь молча показывает пустоту
    const today = dtstamp.slice(0, 8);
    const tomorrow = stamp(new Date(now.getTime() + 86_400_000)).slice(0, 8);
    event(`pro-${today}`, [
      `DTSTART;VALUE=DATE:${today}`, `DTEND;VALUE=DATE:${tomorrow}`,
      `SUMMARY:${esc(`${NAME}: календарь — функция Pro`)}`,
      `DESCRIPTION:${esc("Встречи и дела снова появятся здесь, когда подписка Pro будет активна. Оформить: /pro в боте.")}`,
      "TRANSP:TRANSPARENT",
    ]);
  } else {
    for (const e of feed.events) {
      event(e.id, [
        `DTSTART:${e.starts_at}`, `DTEND:${e.ends_at}`,
        `SUMMARY:${esc(e.title)}`,
        ...(e.with_whom ? [`DESCRIPTION:${esc(`С кем: ${e.with_whom}`)}`] : []),
        ...(appUrl ? [`URL:${appUrl}`] : []),
      ]);
    }
    for (const t of feed.tasks) {
      event(t.id, [
        ...(t.has_time ? [`DTSTART:${t.due_at}`, `DTEND:${t.due_end}`]
          : [`DTSTART;VALUE=DATE:${t.date}`, `DTEND;VALUE=DATE:${t.next_date}`]),
        `SUMMARY:${esc(`☑️ ${t.title}`)}`,
        // дело не занимает время в календаре — не блокировать слот
        "TRANSP:TRANSPARENT",
        ...(appUrl ? [`URL:${appUrl}`] : []),
      ]);
    }
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
