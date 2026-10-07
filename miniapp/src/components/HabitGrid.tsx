import { weekColumns, type Cell } from "../charts";
import { fmtDayTitle } from "../format";
import type { HabitDay } from "../types";

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/**
 * Колонка — календарная неделя, строка — день недели.
 * Раньше сетка резалась «по 7 от начала массива», поэтому колонки не совпадали
 * с неделями и нельзя было увидеть «срываюсь на выходных». Подписей дней тоже не было.
 * И клетки были не кликабельны: отметить забытый вчерашний день было нечем.
 */
export function HabitGrid({ days, today, onToggle }: {
  days: HabitDay[];
  today: string;
  onToggle?: (date: string, done: boolean) => void;
}) {
  const cols = weekColumns(days.map((d) => ({ date: d.date, value: d.done })));
  return (
    <div className="hgrid-wrap">
      <div className="hgrid">
        <div className="hgrid-labels" aria-hidden="true">
          {WD.map((w) => <span key={w}>{w}</span>)}
        </div>
        {cols.map((col, i) => (
          <div className="hcol" key={i}>
            {col.map((cell: Cell<boolean>, wd) => {
              if (cell === null) return <div key={wd} className="hcell future" style={{ opacity: 0 }} />;
              const done = cell.value;
              const isFuture = cell.date > today;
              const cls = ["hcell", done ? "on" : "", cell.date === today ? "today" : "", isFuture ? "future" : ""]
                .filter(Boolean).join(" ");
              if (!onToggle || isFuture) return <div key={wd} className={cls} title={fmtDayTitle(cell.date)} />;
              return (
                <button
                  type="button"
                  key={wd}
                  className={cls}
                  aria-pressed={done}
                  aria-label={`${fmtDayTitle(cell.date)} — ${done ? "отмечено" : "не отмечено"}`}
                  onClick={() => onToggle(cell.date, !done)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
