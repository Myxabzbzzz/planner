import { fmtAmount } from "./format";
import type { Forecast } from "./types";

/**
 * Строка прогноза для карточки «Деньги». Сравниваем с лимитом, если он есть, иначе
 * с прошлым месяцем: «к концу месяца уйдёт ~85 000 ₽ — на 12% больше, чем в сентябре».
 */
export function forecastText(f: Forecast): { title: string; hint: string; warn: boolean } {
  const cur = f.base_currency;
  if (f.forecast === null) {
    return { title: "Прогноз появится через пару дней", hint: "По одному-двум дням темп трат ещё не понять", warn: false };
  }
  const title = `≈ ${fmtAmount(f.forecast, cur)} к концу месяца`;
  const regular = f.regular_left > 0 ? ` С учётом регулярных платежей впереди: ${fmtAmount(f.regular_left, cur)}.` : "";
  if (f.limit !== null) {
    const over = f.forecast - f.limit;
    return over > 0
      ? { title, hint: `Выйдешь за лимит примерно на ${fmtAmount(over, cur)}.${regular}`, warn: true }
      : { title, hint: `В лимит укладываешься, запас ≈ ${fmtAmount(-over, cur)}.${regular}`, warn: false };
  }
  if (f.prev_month > 0) {
    const pct = Math.round(((f.forecast - f.prev_month) / f.prev_month) * 100);
    const cmp = pct === 0 ? "столько же, сколько в прошлом месяце"
      : `на ${Math.abs(pct)}% ${pct > 0 ? "больше" : "меньше"}, чем в прошлом месяце`;
    return { title, hint: `Это ${cmp}.${regular}`, warn: pct >= 15 };
  }
  return { title, hint: `Темп по тратам этого месяца.${regular}`, warn: false };
}

/** «каждое 5-е · следующий 05.11» */
export const regularWhen = (day: number, nextOn: string) =>
  `каждое ${day}-е · следующий ${nextOn.slice(8, 10)}.${nextOn.slice(5, 7)}`;
