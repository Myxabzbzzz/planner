import { SHORT_WEEKDAYS } from "../format";
import { haptic } from "../telegram";
import { IconChevron } from "./Icons";

/**
 * Полоса недели со стрелками: календарь больше не заперт в текущей неделе
 * (встречу на следующий вторник раньше нельзя было увидеть вообще).
 */
export function WeekStrip({ days, selected, today, marked, onSelect, onShift }: {
  days: string[];
  selected: string;
  today: string;
  marked: Set<string>;
  onSelect: (d: string) => void;
  onShift: (delta: number) => void;
}) {
  return (
    <div className="weekbar">
      <button type="button" className="icon-btn" aria-label="Предыдущая неделя"
        onClick={() => { haptic(); onShift(-1); }}><IconChevron dir="left" /></button>
      <div className="week">
        {days.map((d, i) => (
          <button
            type="button"
            key={d}
            className={`wd${d === selected ? " on" : ""}${d === today ? " today" : ""}`}
            aria-pressed={d === selected}
            onClick={() => { haptic(); onSelect(d); }}
          >
            <span className="wd-name">{SHORT_WEEKDAYS[i]}</span>
            <span className="wd-num">{Number(d.slice(8, 10))}</span>
            <span className={marked.has(d) ? "wd-dot has" : "wd-dot"} />
          </button>
        ))}
      </div>
      <button type="button" className="icon-btn" aria-label="Следующая неделя"
        onClick={() => { haptic(); onShift(1); }}><IconChevron dir="right" /></button>
    </div>
  );
}
