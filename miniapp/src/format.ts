const SYMBOLS: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€", UZS: "сум", KZT: "₸" };
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
export const SHORT_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function fmtNumber(n: number): string {
  const [int, frac] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === "00" ? grouped : `${grouped},${frac}`;
}

const sym = (c: string) => SYMBOLS[c] ?? c;
export const fmtAmount = (n: number, cur: string) => `${fmtNumber(n)} ${sym(cur)}`;

export function fmtRateNote(orig: { amount: number; currency: string; rate: number }, base: string): string {
  const head = `${fmtAmount(orig.amount, orig.currency)} по курсу`;
  return orig.rate >= 1
    ? `${head} ${fmtNumber(orig.rate)}`
    : `${head} 1 ${sym(base)} = ${fmtNumber(1 / orig.rate)} ${sym(orig.currency)}`;
}
export const fmtTime = (iso: string) => iso.slice(11, 16);
export const fmtShortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const parseDate = (isoDate: string) => {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export function fmtDayTitle(isoDate: string): string {
  const d = parseDate(isoDate);
  return `${d.getUTCDate()} ${MONTHS_GEN[d.getUTCMonth()]}, ${WEEKDAYS[d.getUTCDay()]}`;
}

export function monthTitle(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS_NOM[m - 1]} ${y}`;
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function todayIso(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

export const currentMonth = (tz: string) => todayIso(tz).slice(0, 7);

export function weekDays(isoDate: string): string[] {
  const d = parseDate(isoDate);
  const mondayOffset = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - mondayOffset * 86_400_000);
  return Array.from({ length: 7 }, (_, i) => isoOf(new Date(monday.getTime() + i * 86_400_000)));
}
