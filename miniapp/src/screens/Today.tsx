import { useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { EventSheet, TaskSheet } from "../components/ItemSheets";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtAmount, fmtDayTitle, todayIso } from "../format";
import { useLoad } from "../load";
import { useToggles } from "../useToggles";
import type { Me, Today as TodayData } from "../types";

export function Today({ api, me, refresh = 0 }: { api: Api; me: Me; refresh?: number }) {
  const { data, error, loading, reload } = useLoad(() => api.today(), [api], refresh);
  const { over, toggle, reset } = useToggles();
  const retry = () => {
    reset();
    reload();
  };
  const [editing, setEditing] = useState<
    { kind: "event"; item: TodayData["events"][number] } | { kind: "task"; item: TodayData["tasks"][number] } | null>(null);
  const saved = () => { setEditing(null); retry(); };
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={retry} />;
  const cur = data.base_currency;
  const left = data.limit !== null ? data.limit - data.month_spent : null;
  const used = data.limit ? Math.min(1, data.month_spent / data.limit) : 0;
  return (
    <>
      <p className="sub">{fmtDayTitle(todayIso(me.tz))}</p>
      <Card>
        <h3>Потрачено сегодня</h3>
        <div className="big-number">{fmtAmount(data.spent_today, cur)}</div>
        {data.limit !== null && (
          <>
            <div className={left! < 0 ? "progress over" : "progress"}><div style={{ width: `${used * 100}%` }} /></div>
            <div className="sub">
              {left! >= 0
                ? `Осталось ${fmtAmount(left!, cur)} из ${fmtAmount(data.limit, cur)} на месяц`
                : `Лимит превышен на ${fmtAmount(-left!, cur)}`}
            </div>
          </>
        )}
      </Card>
      {data.events.length === 0 && data.tasks.length === 0
        ? <Empty title="Сегодня ничего не запланировано" hint="Скажи боту «завтра в 15 встреча с Андреем»" />
        : null}
      {data.events.length > 0 && (
        <Card className="timeline">
          <h3>Встречи</h3>
          {data.events.map((e) => {
            const k = `e:${e.id}`;
            const d = over[k] ?? e.done;
            return (
              <div className="row" key={e.id}>
                <Check done={d} label="Встреча прошла" onToggle={() => void toggle(k, d, (v) => api.setEventDone(e.id, v))} />
                <span className="time">{e.time}</span>
                <button type="button" className={d ? "grow ellipsis done-text tap" : "grow ellipsis tap"}
                  onClick={() => setEditing({ kind: "event", item: e })}>{e.title}</button>
              </div>
            );
          })}
        </Card>
      )}
      {data.tasks.length > 0 && (
        <Card>
          <h3>Задачи</h3>
          {data.tasks.map((t) => {
            const k = `t:${t.id}`;
            const d = over[k] ?? false;
            return (
              <div className="row" key={t.id}>
                <Check done={d} label="Задача выполнена" onToggle={() => void toggle(k, d, (v) => api.setTaskDone(t.id, v))} />
                <button type="button" className={d ? "grow ellipsis done-text tap" : "grow ellipsis tap"}
                  onClick={() => setEditing({ kind: "task", item: t })}>{t.title}</button>
                {t.overdue && !d && <span className="right danger">просрочено</span>}
              </div>
            );
          })}
          {data.tasks_more > 0 && <div className="row muted">…и ещё {data.tasks_more}</div>}
        </Card>
      )}
      {data.habits.length > 0 && (
        <Card>
          <h3>Привычки</h3>
          {data.habits.map((h) => {
            const k = `h:${h.id}`;
            const d = over[k] ?? h.done;
            return (
              <button type="button" key={h.id} className={d ? "pill done" : "pill"} aria-pressed={d}
                onClick={() => void toggle(k, d, (v) => api.setHabitToday(h.id, v))}>{d ? "✓" : "○"} {h.name}</button>
            );
          })}
        </Card>
      )}
      {editing?.kind === "event" && <EventSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />}
      {editing?.kind === "task" && <TaskSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
