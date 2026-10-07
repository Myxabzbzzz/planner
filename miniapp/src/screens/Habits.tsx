import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { HabitGrid } from "../components/HabitGrid";
import { HabitSheet } from "../components/ItemSheets";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { useLoad } from "../load";
import { habitView } from "../habitView";
import { useToggles } from "../useToggles";
import type { HabitsResp } from "../types";

export function Habits({ api, refresh = 0 }: { api: Api; refresh?: number }) {
  const { data, error, loading, reload } = useLoad(() => api.habits(4), [api], refresh);
  const { over, toggle, reset } = useToggles();
  useEffect(reset, [data, reset]);
  const [editing, setEditing] = useState<HabitsResp["habits"][number] | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={reload} />;
  if (data.habits.length === 0) return <Empty title="Привычек пока нет" hint="Скажи боту «хочу трекать зарядку»" />;
  return (
    <>
      {data.habits.map((h) => {
        const v = habitView(h, over[h.id]);
        const d = v.done;
        return (
        <Card key={h.id}>
          <div className="habit-head">
            <Check done={d} label="Привычка выполнена сегодня"
              onToggle={() => void toggle(h.id, d, (x) => api.setHabitToday(h.id, x))} />
            <button type="button" className="habit-name tap ellipsis" onClick={() => setEditing(h)}>{h.name}</button>
            {v.streak > 0
              ? <span className="streak"><b>{v.streak}</b><span>дн. подряд</span></span>
              : <span className="streak none"><span>серии нет</span></span>}
          </div>
          <HabitGrid days={v.days} />
          <div className="sub">{d ? "Сегодня отмечено ✓" : "Сегодня ещё не отмечено"}</div>
        </Card>
        );
      })}
      {editing && <HabitSheet api={api} item={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}
