import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { HabitGrid } from "../components/HabitGrid";
import { HabitSheet } from "../components/ItemSheets";
import { Meter } from "../components/Meter";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { todayIso } from "../format";
import { habitView } from "../habitView";
import { weekProgress, weeksMet } from "../habitWeek";
import { useLoad } from "../load";
import { hapticResult } from "../telegram";
import { useToggles } from "../useToggles";
import type { Habit, Me } from "../types";

const WEEKS = 8;

export function Habits({ api, me, refresh = 0, onAdd }: {
  api: Api; me: Me; refresh?: number; onAdd: () => void;
}) {
  const { data, error, loading, reload } = useLoad(() => api.habits(WEEKS), [api], refresh);
  const { over, toggle, reset } = useToggles();
  useEffect(reset, [data, reset]);
  const [editing, setEditing] = useState<Habit | null>(null);
  const today = todayIso(me.tz);

  /** Отметка любого дня, не только сегодняшнего: воркер всегда ставил лог на сегодня. */
  const markDay = async (id: string, date: string, done: boolean) => {
    try {
      await api.setHabitOn(id, date, done);
      hapticResult(true);
      reload();
    } catch {
      hapticResult(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={reload} />;
  if (data.habits.length === 0) {
    return (
      <Empty
        title="Привычек пока нет"
        hint="Скажи боту «хочу трекать зарядку» — или добавь вручную"
        action={{ label: "Добавить привычку", onClick: onAdd }}
      />
    );
  }

  return (
    <>
      {data.habits.map((h) => {
        const v = habitView(h, over[h.id]);
        const week = weekProgress(v.days, h.target_per_week);
        const metWeeks = weeksMet(v.days, h.target_per_week);
        return (
          <Card key={h.id}>
            <div className="row" style={{ padding: 0, borderTop: 0 }}>
              <Check done={v.done} label="Отмечено сегодня"
                onToggle={() => void toggle(h.id, v.done, (x) => api.setHabitToday(h.id, x))} />
              <button type="button" className="row-title grow ellipsis" style={{ fontWeight: 600 }}
                onClick={() => setEditing(h)}>
                {h.name}
              </button>
              {/* ≥7 дней — чип получает еле заметную штриховку */}
              {v.streak > 0 && (
                <span className={v.streak >= 7 ? "streak long" : "streak"}>
                  <b className="num">{v.streak}</b> подряд
                </span>
              )}
            </div>

            {/* Недельная цель наконец видна: раньше target_per_week хранился и не использовался */}
            <div style={{ marginTop: 14 }}>
              <div className="row" style={{ padding: 0, minHeight: 0, borderTop: 0 }}>
                <span className="hint grow" style={{ fontSize: 13 }}>
                  {h.target_per_week === 7 ? "Каждый день" : `Цель: ${h.target_per_week} раза в неделю`}
                </span>
                <span className="meta num">{week.done} / {week.target}</span>
              </div>
              <Meter value={week.target === 0 ? 0 : week.done / week.target}
                label={`На этой неделе ${week.done} из ${week.target}`} />
              <div className="card-foot">
                {week.met
                  ? metWeeks > 1 ? `Неделя взята · ${metWeeks} недели подряд` : "Неделя взята"
                  : `Осталось ${week.left} до цели недели`}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <HabitGrid days={v.days} today={today} onToggle={(date, done) => void markDay(h.id, date, done)} />
            </div>
            <div className="card-foot">Нажми на клетку, чтобы отметить прошедший день.</div>
          </Card>
        );
      })}

      {editing && (
        <HabitSheet api={api} item={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}
