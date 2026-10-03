import { useEffect } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { HabitGrid } from "../components/HabitGrid";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { useLoad } from "../load";
import { habitView } from "../habitView";
import { useToggles } from "../useToggles";

export function Habits({ api }: { api: Api }) {
  const { data, error, loading, reload } = useLoad(() => api.habits(4), [api]);
  const { over, toggle, reset } = useToggles();
  useEffect(reset, [data, reset]);
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
          <div className="row" style={{ paddingTop: 0 }}>
            <Check done={d} label="Привычка выполнена сегодня"
              onToggle={() => void toggle(h.id, d, (x) => api.setHabitToday(h.id, x))} />
            <span className="grow"><b>{h.name}</b></span>
            <span className="right">{v.streak > 0 ? `🔥 ${v.streak} дн.` : "серии нет"}</span>
          </div>
          <HabitGrid days={v.days} />
          <div className="sub">{d ? "Сегодня отмечено ✓" : "Сегодня ещё не отмечено"}</div>
        </Card>
        );
      })}
    </>
  );
}
