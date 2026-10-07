import type { HabitDay } from "./types";

// BEAR PLANNER categorical order: honey, russet, steel, olive, rosewood, verdigris, caramel, heather.
// Validated for the dark surface #1E1712 (dataviz validate_palette.js: L band, chroma, CVD ΔE ≥ 11, normal ΔE ≥ 17, ≥ 3:1).
export const PALETTE = ["#B88B35", "#A44A32", "#4786B9", "#849245", "#99516F", "#36A697", "#B7743D", "#846CAE"];

export type Slice = { name: string; amount: number; share: number; offset: number; color: string };

export function donutSlices(items: { name: string; amount: number }[], total?: number): Slice[] {
  const sum = total ?? items.reduce((s, i) => s + i.amount, 0);
  if (sum <= 0) return [];
  let offset = 0;
  return items.map((it, i) => {
    const share = it.amount / sum;
    const slice = { name: it.name, amount: it.amount, share, offset, color: PALETTE[i % PALETTE.length] };
    offset += share;
    return slice;
  });
}

export function barHeights(byDay: { date: string; expense: number }[], month: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const map = new Map(byDay.map((d) => [Number(d.date.slice(8, 10)), d.expense]));
  const max = Math.max(0, ...byDay.map((d) => d.expense));
  return Array.from({ length: days }, (_, i) => {
    const value = map.get(i + 1) ?? 0;
    return { day: i + 1, value, h: max > 0 ? value / max : 0 };
  });
}

export function habitColumns(days: HabitDay[]): HabitDay[][] {
  const cols: HabitDay[][] = [];
  for (let i = 0; i < days.length; i += 7) cols.push(days.slice(i, i + 7));
  return cols;
}
