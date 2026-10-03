import { habitColumns } from "../charts";
import type { HabitDay } from "../types";

export function HabitGrid({ days }: { days: HabitDay[] }) {
  return (
    <div className="hgrid">
      {habitColumns(days).map((col, i) => (
        <div className="hcol" key={i}>
          {col.map((d) => <div key={d.date} className={d.done ? "hcell on" : "hcell"} title={d.date} />)}
        </div>
      ))}
    </div>
  );
}
