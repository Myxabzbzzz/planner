import { useState } from "react";
import type { Api } from "../api";
import { DayBars, RankedBars, ShareBar } from "../components/Charts";
import { IconChevron } from "../components/Icons";
import { Meter } from "../components/Meter";
import { OpSheet } from "../components/OpSheet";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { barHeights, categoryShares } from "../charts";
import { currentMonth, fmtAmount, fmtDayTitle, fmtRateNote, monthTitle, shiftMonth, todayIso } from "../format";
import { useLoad } from "../load";
import { haptic } from "../telegram";
import type { Me, Operation } from "../types";

const PAGE = 40;

function groupByDay(ops: Operation[]) {
  const map = new Map<string, Operation[]>();
  for (const o of ops) map.set(o.date, [...(map.get(o.date) ?? []), o]);
  return [...map.entries()];
}

export function Money({ api, me, refresh = 0, onAdd, onSettings, onBudgets }: {
  api: Api; me: Me; refresh?: number; onAdd: () => void; onSettings: () => void; onBudgets: () => void;
}) {
  const thisMonth = currentMonth(me.tz);
  const [month, setMonth] = useState(thisMonth);
  const { data, error, loading, reload } = useLoad(() => api.money(month), [api, month], refresh);
  const [editing, setEditing] = useState<Operation | null>(null);
  const [shown, setShown] = useState(PAGE);
  const go = (d: number) => {
    haptic();
    setShown(PAGE);
    setMonth((m) => shiftMonth(m, d));
  };

  const header = (
    <div className="card-head">
      <button type="button" className="icon-btn" onClick={() => go(-1)} aria-label="Предыдущий месяц">
        <IconChevron dir="left" />
      </button>
      <h2 className="grow" style={{ textAlign: "center" }}>{monthTitle(month)}</h2>
      <button type="button" className="icon-btn" onClick={() => go(1)} disabled={month >= thisMonth}
        aria-label="Следующий месяц">
        <IconChevron dir="right" />
      </button>
    </div>
  );

  if (loading && !data) return <>{header}<Loading hero /></>;
  if (error || !data) return <>{header}<ErrorCard onRetry={reload} /></>;

  const cur = data.base_currency;
  const shares = categoryShares(data.by_category);
  const today = month === thisMonth ? Number(todayIso(me.tz).slice(8, 10)) : undefined;
  const left = data.limit !== null ? data.limit - data.expense : null;
  const ops = data.operations.slice(0, shown);

  return (
    <>
      {header}

      <Card>
        <div className="hero-label">Расходы</div>
        <div className="hero-num">{fmtAmount(data.expense, cur)}</div>
        <div className="sub">
          Доходы <span className="income">{fmtAmount(data.income, cur)}</span>
        </div>
        {data.limit !== null ? (
          <>
            <Meter value={data.expense / data.limit} over={left !== null && left < 0} label="Лимит на месяц" />
            <div className="sub">
              {left! >= 0
                ? `Осталось ${fmtAmount(left!, cur)} из ${fmtAmount(data.limit, cur)}`
                : <span className="danger">Лимит превышен на {fmtAmount(-left!, cur)}</span>}
            </div>
          </>
        ) : (
          <div className="card-foot">
            <button type="button" className="btn quiet" style={{ padding: 0 }} onClick={onSettings}>
              Задать лимит на месяц
            </button>
          </div>
        )}
      </Card>

      {data.expense === 0 && data.income === 0 ? (
        <Empty
          title="В этом месяце операций нет"
          hint="Скажи боту «кофе 400» — или добавь вручную"
          action={{ label: "Добавить операцию", onClick: onAdd }}
        />
      ) : (
        <>
          {shares.length > 0 && (
            <Card>
              <div className="card-head">
                <h3 className="grow">Куда уходит</h3>
                <button type="button" className="btn quiet" style={{ minHeight: 32, padding: 0 }} onClick={onBudgets}>
                  Лимиты
                </button>
              </div>
              <ShareBar shares={shares} />
              <RankedBars shares={shares} currency={cur} />
            </Card>
          )}

          <Card>
            <h3>По дням</h3>
            <DayBars bars={barHeights(data.by_day, month)} today={today} currency={cur} />
          </Card>

          <Card className="flush">
            <h3>Операции</h3>
            {groupByDay(ops).map(([date, dayOps]) => (
              <div key={date}>
                <div className="day-head">{fmtDayTitle(date)}</div>
                {dayOps.map((o) => (
                  <div className="row" key={o.id}>
                    <button type="button" className="row-title grow" onClick={() => { haptic(); setEditing(o); }}>
                      <span className="ellipsis" style={{ display: "block" }}>{o.title || o.category}</span>
                      <span className="row-sub">
                        {o.category}
                        {o.orig && ` · ${fmtRateNote(o.orig, cur)}`}
                      </span>
                    </button>
                    <span className={o.type === "income" ? "rank-val income" : "rank-val"}>
                      {o.type === "income" ? "+" : "−"}{fmtAmount(o.amount, cur)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {/* Раньше список операций обрывался молча на 200 без всякой кнопки */}
            {data.operations.length > shown && (
              <div style={{ padding: "12px 16px 0" }}>
                <button type="button" className="btn ghost wide" onClick={() => setShown((n) => n + PAGE)}>
                  Показать ещё
                </button>
              </div>
            )}
            {data.operations.length >= 200 && shown >= data.operations.length && (
              <div className="card-foot" style={{ padding: "8px 16px 0" }}>
                Показаны последние 200 операций месяца. Суммы и графики выше считаются по всем.
              </div>
            )}
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
