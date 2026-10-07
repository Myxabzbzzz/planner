import { habitColumns } from "../charts";
import type { HabitDay } from "../types";

/** Weeks left to right, days inside a week left to right; the last cell is today. */
export function HabitGrid({ days }: { days: HabitDay[] }) {
  const last = days[days.length - 1]?.date;
  return (
    <div className="hgrid">
      {habitColumns(days).map((col, i) => (
        <div className="hcol" key={i}>
          {col.map((d) => (
            <div key={d.date} className={`hcell${d.done ? " on" : ""}${d.date === last ? " today" : ""}`} title={d.date} />
          ))}
        </div>
      ))}
    </div>
  );
}
