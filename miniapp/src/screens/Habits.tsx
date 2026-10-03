import { useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { HabitGrid } from "../components/HabitGrid";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { useLoad } from "../load";
import { optimisticToggle } from "../optimistic";
import { hapticResult } from "../telegram";

export function Habits({ api }: { api: Api }) {
  const { data, error, loading, reload } = useLoad(() => api.habits(4), [api]);
  const [over, setOver] = useState<Record<string, boolean>>({});
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={reload} />;
  if (data.habits.length === 0) return <Empty title="Привычек пока нет" hint="Скажи боту «хочу трекать зарядку»" />;
  return (
    <>
      {data.habits.map((h) => {
        const d = over[h.id] ?? h.done_today;
        return (
        <Card key={h.id}>
          <div className="row" style={{ paddingTop: 0 }}>
            <Check done={d} label="Привычка выполнена сегодня"
              onToggle={() => void optimisticToggle(d, (v) => setOver((m) => ({ ...m, [h.id]: v })), (v) => api.setHabitToday(h.id, v), hapticResult)} />
            <span className="grow"><b>{h.name}</b></span>
            <span className="right">{h.streak > 0 ? `🔥 ${h.streak} дн.` : "серии нет"}</span>
          </div>
          <HabitGrid days={h.days} />
          <div className="sub">{d ? "Сегодня отмечено ✓" : "Сегодня ещё не отмечено"}</div>
        </Card>
        );
      })}
    </>
  );
}
