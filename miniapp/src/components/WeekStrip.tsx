import { SHORT_WEEKDAYS } from "../format";
import { haptic } from "../telegram";

export function WeekStrip({ days, selected, today, marked, onSelect }: {
  days: string[]; selected: string; today: string; marked: Set<string>; onSelect: (d: string) => void;
}) {
  return (
    <div className="week">
      {days.map((d, i) => (
        <button key={d} className={`wd${d === selected ? " sel" : ""}${d === today ? " today" : ""}`}
          onClick={() => { haptic(); onSelect(d); }}>
          <span className="wd-name">{SHORT_WEEKDAYS[i]}</span>
          <span className="wd-num">{Number(d.slice(8, 10))}</span>
          <span className={marked.has(d) ? "wd-dot on" : "wd-dot"} />
        </button>
      ))}
    </div>
  );
}
