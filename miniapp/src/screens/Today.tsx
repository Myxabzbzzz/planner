import { useEffect, useState } from "react";
import type { Api } from "../api";
import { buildAgenda, dayProgress } from "../agenda";
import { Check } from "../components/Check";
import { EventSheet, TaskSheet } from "../components/ItemSheets";
import { Meter, Ring } from "../components/Meter";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { IconChevron, IconTick } from "../components/Icons";
import { fmtAmount, fmtDayTitle, todayIso } from "../format";
import { useLoad } from "../load";
import { useToggles } from "../useToggles";
import type { Me, Today as TodayData } from "../types";

/**
 * Один хронологический список вместо двух карточек «Встречи» и «Задачи»:
 * день читается сверху вниз, как он и происходит.
 */
export function Today({ api, me, refresh = 0, onAdd, onSettings, pending = 0, onReviews }: {
  api: Api; me: Me; refresh?: number; onAdd: () => void; onSettings: () => void;
  pending?: number; onReviews: () => void;
}) {
  const { data, error, loading, reload } = useLoad(() => api.today(), [api], refresh);
  const { over, toggle, reset } = useToggles();
  // Оптимистичные отметки сбрасываются при любых новых данных, а не только при retry:
  // иначе привычка, отмеченная в чате бота, оставалась здесь неотмеченной.
  useEffect(reset, [data, reset]);
  const [editing, setEditing] = useState<
    | { kind: "event"; item: TodayData["events"][number] }
    | { kind: "task"; item: TodayData["tasks"][number] }
    | null
  >(null);
  const saved = () => { setEditing(null); reload(); };

  if (loading && !data) return <Loading hero />;
  if (error || !data) return <ErrorCard onRetry={() => { reset(); reload(); }} />;

  const cur = data.base_currency;
  const left = data.limit !== null ? data.limit - data.month_spent : null;
  const used = data.limit ? data.month_spent / data.limit : 0;
  const rows = buildAgenda(data);
  const progress = dayProgress(data, over);
  const nothing = rows.length === 0 && data.habits.length === 0;

  return (
    <>
      <p className="dateline">{fmtDayTitle(todayIso(me.tz))}</p>

      {/* Пока вопрос не отвечен, запись не сохранена — это первое, что надо увидеть */}
      {pending > 0 && (
        <button type="button" className="tapcard" onClick={onReviews}>
          <Card className="ask">
            <div className="row" style={{ padding: 0, borderTop: 0 }}>
              <span className="ask-dot" aria-hidden="true" />
              <span className="grow">
                {pending === 1 ? "ИИ ждёт ответа на вопрос" : `ИИ ждёт ответа: ${pending} вопроса`}
                <span className="row-sub">Пока не ответишь, запись не сохранится</span>
              </span>
              <IconChevron dir="right" />
            </div>
          </Card>
        </button>
      )}

      <Card>
        <div className="level">
          {progress.total > 0 && (
            <Ring value={progress.done / progress.total} size={62} width={6}
              label={`Сделано ${progress.done} из ${progress.total}`}>
              <span className="num" style={{ font: "600 16px/1 var(--display)" }}>{progress.done}</span>
              <span className="hint" style={{ fontSize: 10 }}>из {progress.total}</span>
            </Ring>
          )}
          <div className="grow">
            <div className="hero-label">Потрачено сегодня</div>
            <div className="hero-num sm">{fmtAmount(data.spent_today, cur)}</div>
          </div>
        </div>
        {data.limit !== null ? (
          <>
            <Meter value={used} over={left !== null && left < 0} label="Лимит на месяц" />
            <div className="sub">
              {left! >= 0
                ? `Осталось ${fmtAmount(left!, cur)} из ${fmtAmount(data.limit, cur)} на месяц`
                : <span className="danger">Лимит превышен на {fmtAmount(-left!, cur)}</span>}
            </div>
          </>
        ) : (
          <div className="card-foot">
            <button type="button" className="btn quiet" onClick={onSettings} style={{ padding: 0 }}>
              Задать лимит на месяц
            </button>
          </div>
        )}
      </Card>

      {nothing ? (
        <Empty
          title="На сегодня ничего не запланировано"
          hint="Надиктуй боту «завтра в 15 встреча с Андреем» — или добавь вручную"
          action={{ label: "Добавить", onClick: onAdd }}
        />
      ) : (
        rows.length > 0 && (
          <Card className="flush">
            <h3>План дня</h3>
            {rows.map((r) => {
              const done = over[r.key] ?? (r.kind === "event" ? r.item.done : false);
              const overdue = r.kind === "task" && r.item.overdue && !done;
              return (
                <div className="row" key={r.key}>
                  <Check
                    done={done}
                    label={r.kind === "event" ? "Встреча прошла" : "Задача выполнена"}
                    onToggle={() =>
                      void toggle(r.key, done, (v) =>
                        r.kind === "event" ? api.setEventDone(r.item.id, v) : api.setTaskDone(r.item.id, v))}
                  />
                  <span className="time-chip num">{r.at ?? "—"}</span>
                  <button type="button" className={done ? "row-title ellipsis done-text" : "row-title ellipsis"}
                    onClick={() => setEditing(
                      r.kind === "event" ? { kind: "event", item: r.item } : { kind: "task", item: r.item })}>
                    {r.item.title}
                  </button>
                  {overdue && <span className="meta danger">просрочено</span>}
                  {r.kind === "event" && r.item.with_whom && <span className="meta">{r.item.with_whom}</span>}
                </div>
              );
            })}
            {data.tasks_more > 0 && (
              <div className="card-foot" style={{ padding: "8px 16px 0" }}>…и ещё {data.tasks_more} задач</div>
            )}
          </Card>
        )
      )}

      {data.habits.length > 0 && (
        <Card>
          <h3>Привычки</h3>
          <div className="chips">
            {data.habits.map((h) => {
              const k = `h:${h.id}`;
              const done = over[k] ?? h.done;
              return (
                <button type="button" key={h.id} className={done ? "pill on" : "pill"} aria-pressed={done}
                  onClick={() => void toggle(k, done, (v) => api.setHabitToday(h.id, v))}>
                  <span className="pill-mark">{done && <IconTick size={10} />}</span>
                  {h.name}
                </button>
              );
            })}
          </div>
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
