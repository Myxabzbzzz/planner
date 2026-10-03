import { useState } from "react";
import type { Api } from "../api";
import { Bars } from "../components/Bars";
import { Donut } from "../components/Donut";
import { OpSheet } from "../components/OpSheet";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { barHeights, donutSlices } from "../charts";
import { currentMonth, fmtAmount, fmtDayTitle, fmtRateNote, monthTitle, shiftMonth, todayIso } from "../format";
import { useLoad } from "../load";
import { haptic } from "../telegram";
import type { Me, Operation } from "../types";

function groupByDay(ops: Operation[]) {
  const map = new Map<string, Operation[]>();
  for (const o of ops) map.set(o.date, [...(map.get(o.date) ?? []), o]);
  return [...map.entries()];
}

export function Money({ api, me }: { api: Api; me: Me }) {
  const thisMonth = currentMonth(me.tz);
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading, reload } = useLoad(() => api.money(month), [api, month]);
  const [editing, setEditing] = useState<Operation | null>(null);
  const go = (d: number) => { haptic(); setMonth((m) => shiftMonth(m, d)); };

  const header = (
    <div className="month-switch">
      <button onClick={() => go(-1)} aria-label="Предыдущий месяц">‹</button>
      <h2>{monthTitle(month)}</h2>
      <button onClick={() => go(1)} disabled={month >= thisMonth} style={{ opacity: month >= thisMonth ? 0.3 : 1 }}
        aria-label="Следующий месяц">›</button>
    </div>
  );
  if (loading && !data) return <>{header}<Loading /></>;
  if (error || !data) return <>{header}<ErrorCard onRetry={reload} /></>;

  const cur = data.base_currency;
  const slices = donutSlices(data.by_category);
  const today = month === thisMonth ? Number(todayIso(me.tz).slice(8, 10)) : undefined;
  const left = data.limit !== null ? data.limit - data.expense : null;

  return (
    <>
      {header}
      <Card>
        <h3>Расходы</h3>
        <div className="big-number">{fmtAmount(data.expense, cur)}</div>
        <div className="sub">
          Доходы <span className="income">{fmtAmount(data.income, cur)}</span>
          {left !== null && <> · {left >= 0 ? `осталось ${fmtAmount(left, cur)}` : <span className="danger">лимит превышен на {fmtAmount(-left, cur)}</span>}</>}
        </div>
      </Card>
      {data.expense === 0 && data.income === 0 ? (
        <Empty title="В этом месяце операций нет" hint="Скажи боту «кофе 40 000»" />
      ) : (
        <>
          {slices.length > 0 && (
            <Card>
              <h3>По категориям</h3>
              <div className="donut-wrap">
                <Donut slices={slices}><span>{slices.length}</span><span>катег.</span></Donut>
                <div className="legend">
                  {slices.map((s) => (
                    <div className="row" key={s.name}>
                      <span className="dot" style={{ background: s.color }} />
                      <span className="grow ellipsis">{s.name}</span>
                      <span className="right">{Math.round(s.share * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
          <Card>
            <h3>По дням</h3>
            <Bars bars={barHeights(data.by_day, month)} today={today} />
          </Card>
          <Card>
            <h3>Операции</h3>
            {groupByDay(data.operations).map(([date, ops]) => (
              <div key={date}>
                <div className="day-head">{fmtDayTitle(date)}</div>
                {ops.map((o) => (
                  <button type="button" className="row op-row" key={o.id} onClick={() => { haptic(); setEditing(o); }}>
                    <div className="grow">
                      <div className="ellipsis">{o.title || o.category}</div>
                      <div className="op-orig">
                        {o.category}
                        {o.orig && ` · ${fmtRateNote(o.orig, cur)}`}
                      </div>
                    </div>
                    <span className={o.type === "income" ? "income" : ""}>
                      {o.type === "income" ? "+" : "−"}{fmtAmount(o.amount, cur)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </Card>
        </>
      )}
      {editing && (
        <OpSheet api={api} op={editing} base={cur} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }} />
      )}
    </>
  );
}
