import type { Api } from "../api";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtAmount, fmtDayTitle, todayIso } from "../format";
import { useLoad } from "../load";
import type { Me } from "../types";

export function Today({ api, me }: { api: Api; me: Me }) {
  const { data, error, loading, reload } = useLoad(() => api.today(), [api]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={reload} />;
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
          {data.events.map((e, i) => (
            <div className="row" key={i}><span className="time">{e.time}</span><span className="grow ellipsis">{e.title}</span></div>
          ))}
        </Card>
      )}
      {data.tasks.length > 0 && (
        <Card>
          <h3>Задачи</h3>
          {data.tasks.map((t) => (
            <div className="row" key={t.id}>
              <span className="grow ellipsis">{t.title}</span>
              {t.overdue && <span className="right danger">просрочено</span>}
            </div>
          ))}
          {data.tasks_more > 0 && <div className="row muted">…и ещё {data.tasks_more}</div>}
        </Card>
      )}
      {data.habits.length > 0 && (
        <Card>
          <h3>Привычки</h3>
          {data.habits.map((h) => (
            <span key={h.id} className={h.done ? "pill done" : "pill"}>{h.done ? "✓" : "○"} {h.name}</span>
          ))}
        </Card>
      )}
    </>
  );
}
