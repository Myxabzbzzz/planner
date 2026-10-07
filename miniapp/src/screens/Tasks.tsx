import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { EventSheet, TaskSheet } from "../components/ItemSheets";
import { Segmented } from "../components/Segmented";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { WeekStrip } from "../components/WeekStrip";
import { fmtDayTitle, fmtShortDate, fmtTime, todayIso, weekDays } from "../format";
import { useLoad } from "../load";
import { useToggles } from "../useToggles";
import type { EventItem, Me, TaskItem } from "../types";

type Filter = "today" | "upcoming" | "nodue" | "done";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "today", label: "Сегодня" }, { key: "upcoming", label: "Скоро" },
  { key: "nodue", label: "Без срока" }, { key: "done", label: "Готово" },
];
const EMPTY: Record<Filter, string> = {
  today: "На сегодня задач нет", upcoming: "Задач со сроком впереди нет",
  nodue: "Задач без срока нет", done: "Выполненных пока нет",
};

export function Tasks({ api, me, refresh = 0 }: { api: Api; me: Me; refresh?: number }) {
  const today = todayIso(me.tz);
  const days = weekDays(today);
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<Filter>("today");
  const events = useLoad(() => api.events(days[0], days[6]), [api, days[0]], refresh);
  const tasks = useLoad(() => api.tasks(filter), [api, filter], refresh);
  const { over, toggle, reset } = useToggles();
  const [editing, setEditing] = useState<{ kind: "event"; item: EventItem & { date: string } } | { kind: "task"; item: TaskItem } | null>(null);
  const saved = () => { setEditing(null); events.reload(); tasks.reload(); };
  useEffect(reset, [events.data, tasks.data, reset]);
  const marked = new Set((events.data?.days ?? []).map((d) => d.date));
  const dayEvents = events.data?.days.find((d) => d.date === day)?.events ?? [];

  return (
    <>
      <WeekStrip days={days} selected={day} today={today} marked={marked} onSelect={setDay} />
      <Card className="timeline">
        <h3>{fmtDayTitle(day)}</h3>
        {events.error ? <button className="button" onClick={events.reload}>Повторить</button>
          : events.loading && !events.data ? <div className="muted">Загрузка…</div>
          : dayEvents.length === 0 ? <div className="muted">Встреч нет</div>
          : dayEvents.map((e) => {
            const k = `e:${e.id}`;
            const d = over[k] ?? e.done;
            return (
              <div className="row" key={e.id}>
                <Check done={d} label="Встреча прошла" onToggle={() => void toggle(k, d, (v) => api.setEventDone(e.id, v))} />
                <span className="time">{e.time}</span>
                <button type="button" className={d ? "grow ellipsis done-text tap" : "grow ellipsis tap"}
                  onClick={() => setEditing({ kind: "event", item: { ...e, date: day } })}>{e.title}</button>
                {e.with_whom && <span className="right">{e.with_whom}</span>}
              </div>
            );
          })}
      </Card>
      <Segmented items={FILTERS} value={filter} onChange={setFilter} />
      {tasks.loading && !tasks.data ? <Loading />
        : tasks.error || !tasks.data ? <ErrorCard onRetry={tasks.reload} />
        : tasks.data.tasks.length === 0 ? <Empty title={EMPTY[filter]} />
        : (
          <Card>
            {tasks.data.tasks.map((t) => {
              const k = `t:${t.id}`;
              const d = over[k] ?? t.done_at !== null;
              return (
              <div className="row" key={t.id}>
                <Check done={d} label="Задача выполнена" onToggle={() => void toggle(k, d, (v) => api.setTaskDone(t.id, v))} />
                <button type="button" className={d ? "grow ellipsis done-text tap" : "grow ellipsis tap"}
                  onClick={() => setEditing({ kind: "task", item: t })}>{t.title}</button>
                {t.due && filter !== "done" && (
                  <span className={t.overdue ? "right danger" : "right"}>
                    {fmtShortDate(t.due)}{fmtTime(t.due) !== "23:59" ? ` ${fmtTime(t.due)}` : ""}
                  </span>
                )}
              </div>
              );
            })}
          </Card>
        )}
      {editing?.kind === "event" && <EventSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />}
      {editing?.kind === "task" && <TaskSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />}
    </>
  );
}
