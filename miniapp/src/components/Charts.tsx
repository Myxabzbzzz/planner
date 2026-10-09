import { useState } from "react";
import { duoHeights, heatLevel, monthHeights, weekColumns, type Cell, type Share } from "../charts";
import { fmtAmount, fmtCompact, fmtShortDate, monthShort } from "../format";
import { haptic } from "../telegram";

/** Состав: одна 100 % полоса. Между сегментами 2 px поверхности, а не обводка. */
export function ShareBar({ shares }: { shares: Share[] }) {
  return (
    <div className="sharebar" aria-hidden="true">
      {shares.map((s) => (
        <i key={s.name} style={{ flexGrow: Math.max(s.share, 0.004), background: s.color }} />
      ))}
    </div>
  );
}

/**
 * Категории ранжированным списком с подписями величин.
 * Читать точные суммы на телефоне так гораздо проще, чем по пончику с легендой,
 * и цвет здесь — ранг, а не идентичность, поэтому легенда не нужна.
 */
export function RankedBars({ shares, currency }: { shares: Share[]; currency: string }) {
  return (
    <div>
      {shares.map((s) => (
        <div className="rank" key={s.name}>
          <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
          <div className="grow">
            <div className="row-title ellipsis" style={{ minHeight: 0 }}>{s.name}</div>
            <div className="rank-bar">
              <i style={{ width: `${Math.max(s.share * 100, 1.5)}%`, background: s.color }} />
            </div>
          </div>
          <span className="rank-val">
            {fmtAmount(s.amount, currency)}
            <span className="hint"> · {Math.round(s.share * 100)}%</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Траты по дням. Слева шкала сумм, чтобы величину было видно без тапа.
 * Выбрать день можно тапом или ведя пальцем по графику: попасть в столбик шириной
 * в несколько пикселей (а у пустого дня его нет вовсе) на телефоне трудно.
 */
export function DayBars({ bars, today, currency }: {
  bars: { day: number; value: number; h: number }[];
  today?: number;
  currency: string;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const picked = sel === null ? null : bars.find((b) => b.day === sel) ?? null;
  const mid = Math.ceil(bars.length / 2);
  const max = Math.max(0, ...bars.map((b) => b.value));

  const dayAt = (el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const i = Math.floor(((clientX - r.left) / r.width) * bars.length);
    return bars[Math.min(bars.length - 1, Math.max(0, i))]?.day ?? null;
  };
  const scrub = (el: HTMLElement, clientX: number) => {
    const d = dayAt(el, clientX);
    if (d !== null && d !== sel) {
      haptic();
      setSel(d);
    }
  };

  return (
    <>
      <div className="bars-wrap">
        {max > 0 && (
          <div className="y-axis" aria-hidden="true">
            <span>{fmtCompact(max)}</span>
            <span>{fmtCompact(Math.round(max / 2))}</span>
            <span>0</span>
          </div>
        )}
        <div
          className="bars"
          onPointerDown={(e) => scrub(e.currentTarget, e.clientX)}
          onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") scrub(e.currentTarget, e.clientX); }}
        >
          {max > 0 && <><i className="grid-line" style={{ bottom: "50%" }} /><i className="grid-line" style={{ bottom: "100%" }} /></>}
          {bars.map((b) => (
            <button
              type="button"
              key={b.day}
              className={`bar-col${b.day === sel ? " sel" : b.day === today ? " now" : ""}`}
              aria-label={`${b.day}-е: ${fmtAmount(b.value, currency)}`}
              aria-pressed={b.day === sel}
              onClick={(e) => {
                // мышь и касание уже выбрали день в onPointerDown; сюда доходит клавиатура
                if (e.detail === 0) setSel((s) => (s === b.day ? null : b.day));
              }}
            >
              <i style={{ height: `${Math.max(b.h * 100, b.value > 0 ? 3 : 0)}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className={max > 0 ? "axis with-y" : "axis"} aria-hidden="true">
        <span>1</span><span>{mid}</span><span>{bars.length}</span>
      </div>
      <div className="card-foot">
        {picked
          ? `${picked.day}-е — ${fmtAmount(picked.value, currency)}`
          : "Нажми или проведи пальцем по графику, чтобы увидеть сумму за день"}
      </div>
    </>
  );
}

/** Задачи по неделям: закрыто против появилось. Общий масштаб, легенда обязательна. */
export function TaskWeeks({ weeks }: { weeks: { week: string; done: number; created: number }[] }) {
  const cols = duoHeights(weeks);
  return (
    <>
      <div className="duo">
        {cols.map((w) => (
          <div className="duo-col" key={w.week} title={`${fmtShortDate(w.week)}: закрыто ${w.done}, появилось ${w.created}`}>
            <i className="done" style={{ height: `${w.hDone * 100}%` }} />
            <i className="made" style={{ height: `${w.hCreated * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis" aria-hidden="true">
        <span>{cols.length > 0 ? fmtShortDate(cols[0].week) : ""}</span>
        <span>сейчас</span>
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--accent)" }} />закрыто</span>
        <span><i style={{ background: "var(--surface-3)" }} />появилось</span>
      </div>
    </>
  );
}

/** Расходы и доходы по месяцам — тоже в общем масштабе, иначе ряды несравнимы. */
export function MoneyMonths({ months, currency }: {
  months: { month: string; expense: number; income: number }[];
  currency: string;
}) {
  const cols = monthHeights(months);
  return (
    <>
      <div className="duo">
        {cols.map((m) => (
          <div
            className="duo-col"
            key={m.month}
            title={`${monthShort(m.month)}: расход ${fmtAmount(m.expense, currency)}, доход ${fmtAmount(m.income, currency)}`}
          >
            <i className="done" style={{ height: `${m.hExpense * 100}%` }} />
            <i className="made" style={{ height: `${m.hIncome * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="axis" aria-hidden="true">
        {cols.map((m) => <span key={m.month}>{monthShort(m.month).slice(0, 3)}</span>)}
      </div>
      <div className="legend">
        <span><i style={{ background: "var(--accent)" }} />расходы</span>
        <span><i style={{ background: "var(--surface-3)" }} />доходы</span>
        {cols.length > 0 && (
          <span className="hint">макс. {fmtCompact(Math.max(...cols.map((m) => Math.max(m.expense, m.income))))}</span>
        )}
      </div>
    </>
  );
}

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Тепловая карта активности: колонка — календарная неделя, строка — день недели. */
export function Heat({ days, total }: { days: { date: string; done: number }[]; total: number }) {
  const cols = weekColumns(days.map((d) => ({ date: d.date, value: d.done })));
  return (
    <div className="hgrid-wrap">
      <div className="hgrid">
        <div className="hgrid-labels" aria-hidden="true">
          {WD.map((w, i) => <span key={w} style={{ height: 14 }}>{i % 2 === 0 ? w : ""}</span>)}
        </div>
        <div className="heat">
          {cols.map((col, i) => (
            <div className="heat-col" key={i}>
              {col.map((cell: Cell<number>, wd) => (
                <div
                  key={wd}
                  className={cell === null ? "heat-cell" : `heat-cell l${heatLevel(cell.value, total)}`}
                  style={cell === null ? { opacity: 0 } : undefined}
                  title={cell === null ? undefined : `${fmtShortDate(cell.date)}: ${cell.value} из ${total}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
