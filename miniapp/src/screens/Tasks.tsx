import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Check } from "../components/Check";
import { EventSheet, TaskSheet } from "../components/ItemSheets";
import { Segmented } from "../components/Segmented";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { WeekStrip } from "../components/WeekStrip";
import { dueLabel, fmtDayTitle, relDay, todayIso, weekDays } from "../format";
import { useLoad } from "../load";
import { useToggles } from "../useToggles";
import type { EventItem, Me, TaskItem } from "../types";

type Filter = "today" | "upcoming" | "nodue" | "done";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "upcoming", label: "Скоро" },
  { key: "nodue", label: "Без срока" },
  { key: "done", label: "Готово" },
];
const EMPTY: Record<Filter, string> = {
  today: "На сегодня задач нет",
  upcoming: "Задач со сроком впереди нет",
  nodue: "Задач без срока нет",
  done: "Выполненных пока нет",
};

const shiftWeek = (iso: string, weeks: number) =>
  new Date(Date.parse(iso + "T00:00:00Z") + weeks * 7 * 86_400_000).toISOString().slice(0, 10);

export function Tasks({ api, me, refresh = 0, onAdd }: {
  api: Api; me: Me; refresh?: number; onAdd: () => void;
}) {
  const today = todayIso(me.tz);
  const [anchor, setAnchor] = useState(today);
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<Filter>("today");
  const days = weekDays(anchor);
  // Календарь больше не заперт в текущей неделе: api_events принимает любой диапазон.
  const events = useLoad(() => api.events(days[0], days[6]), [api, days[0]], refresh);
  const tasks = useLoad(() => api.tasks(filter), [api, filter], refresh);
  const { over, toggle, reset } = useToggles();
  const [editing, setEditing] = useState<
    | { kind: "event"; item: EventItem & { date: string } }
    | { kind: "task"; item: TaskItem }
    | null
  >(null);
  const saved = () => { setEditing(null); events.reload(); tasks.reload(); };
  useEffect(reset, [events.data, tasks.data, reset]);

  const marked = new Set((events.data?.days ?? []).map((d) => d.date));
  const dayEvents = events.data?.days.find((d) => d.date === day)?.events ?? [];

  const shift = (delta: number) => {
    const next = shiftWeek(anchor, delta);
    setAnchor(next);
    setDay(weekDays(next)[0]);
  };

  return (
    <>
      <WeekStrip days={days} selected={day} today={today} marked={marked} onSelect={setDay} onShift={shift} />

      <Card className="flush">
        <div className="card-head" style={{ padding: "0 16px" }}>
          <h3 className="grow">{relDay(day, today) ?? fmtDayTitle(day)}</h3>
          {day !== today && (
            <button type="button" className="btn quiet" style={{ minHeight: 32, padding: 0 }}
              onClick={() => { setAnchor(today); setDay(today); }}>
              К сегодня
            </button>
          )}
        </div>
        {events.error
          ? <div className="row"><button type="button" className="btn ghost" onClick={events.reload}>Повторить</button></div>
          : events.loading && !events.data
          ? <div className="row muted">Загрузка…</div>
          : dayEvents.length === 0
          ? <div className="row muted">Встреч нет</div>
          : dayEvents.map((e) => {
            const k = `e:${e.id}`;
            const done = over[k] ?? e.done;
            return (
              <div className="row" key={e.id}>
                <Check done={done} label="Встреча прошла"
                  onToggle={() => void toggle(k, done, (v) => api.setEventDone(e.id, v))} />
                <span className="time-chip num">{e.time}</span>
                <button type="button" className={done ? "row-title ellipsis done-text" : "row-title ellipsis"}
                  onClick={() => setEditing({ kind: "event", item: { ...e, date: day } })}>
                  {e.title}
                </button>
                {e.with_whom && <span className="meta">{e.with_whom}</span>}
              </div>
            );
          })}
      </Card>

      <Segmented items={FILTERS} value={filter} onChange={setFilter} label="Фильтр задач" />

      {tasks.loading && !tasks.data ? <Loading />
        : tasks.error || !tasks.data ? <ErrorCard onRetry={tasks.reload} />
        : tasks.data.tasks.length === 0
        ? <Empty title={EMPTY[filter]} action={filter === "done" ? undefined : { label: "Добавить задачу", onClick: onAdd }} />
        : (
          <Card className="flush">
            {tasks.data.tasks.map((t) => {
              const k = `t:${t.id}`;
              const done = over[k] ?? t.done_at !== null;
              return (
                <div className="row" key={t.id}>
                  <Check done={done} label="Задача выполнена"
                    onToggle={() => void toggle(k, done, (v) => api.setTaskDone(t.id, v))} />
                  <button type="button" className={done ? "row-title ellipsis done-text" : "row-title ellipsis"}
                    onClick={() => setEditing({ kind: "task", item: t })}>
                    {t.title}
                  </button>
                  {t.due && filter !== "done" && (
                    <span className={t.overdue && !done ? "meta danger" : "meta"}>{dueLabel(t.due, today)}</span>
                  )}
                </div>
              );
            })}
            {/* api_tasks отдаёт максимум 100 задач — честно говорим, что список обрезан */}
            {tasks.data.tasks.length >= 100 && (
              <div className="card-foot" style={{ padding: "8px 16px 0" }}>
                Показаны первые 100. Уточни поиском в чате бота.
              </div>
            )}
          </Card>
        )}

      {editing?.kind === "event" && (
        <EventSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />
      )}
      {editing?.kind === "task" && (
        <TaskSheet api={api} item={editing.item} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </>
  );
}
