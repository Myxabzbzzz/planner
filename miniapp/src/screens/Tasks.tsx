import { useState } from "react";
import type { Api } from "../api";
import { Segmented } from "../components/Segmented";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { WeekStrip } from "../components/WeekStrip";
import { fmtDayTitle, fmtShortDate, fmtTime, todayIso, weekDays } from "../format";
import { useLoad } from "../load";
import type { Me } from "../types";

type Filter = "today" | "upcoming" | "nodue" | "done";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "today", label: "Сегодня" }, { key: "upcoming", label: "Скоро" },
  { key: "nodue", label: "Без срока" }, { key: "done", label: "Готово" },
];
const EMPTY: Record<Filter, string> = {
  today: "На сегодня задач нет 🎉", upcoming: "Задач со сроком впереди нет",
  nodue: "Задач без срока нет", done: "Выполненных пока нет",
};

export function Tasks({ api, me }: { api: Api; me: Me }) {
  const today = todayIso(me.tz);
  const days = weekDays(today);
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<Filter>("today");
  const events = useLoad(() => api.events(days[0], days[6]), [api, days[0]]);
  const tasks = useLoad(() => api.tasks(filter), [api, filter]);
  const marked = new Set((events.data?.days ?? []).map((d) => d.date));
  const dayEvents = events.data?.days.find((d) => d.date === day)?.events ?? [];

  return (
    <>
      <WeekStrip days={days} selected={day} today={today} marked={marked} onSelect={setDay} />
      <Card className="timeline">
        <h3>{fmtDayTitle(day)}</h3>
        {events.error ? <button className="button" onClick={events.reload}>Повторить</button>
          : dayEvents.length === 0 ? <div className="muted">Встреч нет</div>
          : dayEvents.map((e) => (
            <div className="row" key={e.id}>
              <span className="time">{e.time}</span>
              <span className="grow ellipsis">{e.title}</span>
              {e.with_whom && <span className="right">{e.with_whom}</span>}
            </div>
          ))}
      </Card>
      <Segmented items={FILTERS} value={filter} onChange={setFilter} />
      {tasks.loading && !tasks.data ? <Loading />
        : tasks.error || !tasks.data ? <ErrorCard onRetry={tasks.reload} />
        : tasks.data.tasks.length === 0 ? <Empty title={EMPTY[filter]} />
        : (
          <Card>
            {tasks.data.tasks.map((t) => (
              <div className="row" key={t.id}>
                <span className={filter === "done" ? "grow ellipsis muted" : "grow ellipsis"}>{t.title}</span>
                {t.due && filter !== "done" && (
                  <span className={t.overdue ? "right danger" : "right"}>
                    {fmtShortDate(t.due)}{fmtTime(t.due) !== "23:59" ? ` ${fmtTime(t.due)}` : ""}
                  </span>
                )}
              </div>
            ))}
          </Card>
        )}
    </>
  );
}
