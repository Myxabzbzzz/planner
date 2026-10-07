import { useState } from "react";
import type { Api } from "../api";
import { fmtAmount, fmtNumber, monthTitle } from "../format";
import { parseAmount } from "../opEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import type { BudgetsResp } from "../types";
import { useLoad } from "../load";
import { Meter } from "./Meter";
import { Sheet } from "./Sheet";

/**
 * Лимиты по категориям.
 *
 * `budgets.category_id` и `ask_limit_left(p_category)` поддерживали их с самого
 * начала, но `set_limit` умел писать только строку с `category_id is null`,
 * а интерфейса не было вовсе — схема простаивала.
 */
export function BudgetsSheet({ api, month, onClose, onChanged }: {
  api: Api; month: string; onClose: () => void; onChanged: () => void;
}) {
  const { data, error, loading, reload } = useLoad(() => api.budgets(month), [api, month]);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const save = async (name: string, raw: string) => {
    const amount = raw.trim() === "" ? 0 : parseAmount(raw);
    if (amount === null) {
      setFailed("Не похоже на сумму.");
      return;
    }
    setBusy(name);
    setFailed(null);
    try {
      await api.setCategoryLimit(name, amount);
      hapticResult(true);
      setEdit((e) => {
        const next = { ...e };
        delete next[name];
        return next;
      });
      reload();
      onChanged();
    } catch (e) {
      hapticResult(false);
      setFailed(saveError(e));
    } finally {
      setBusy(null);
    }
  };

  const body = (d: BudgetsResp) => (
    <>
      <div className="card-foot">Потрачено за {monthTitle(month).toLowerCase()}. Пусто или 0 — лимита нет.</div>
      {d.categories.map((c) => {
        const value = edit[c.name] ?? (c.limit === null ? "" : fmtNumber(c.limit));
        const dirty = edit[c.name] !== undefined;
        const over = c.limit !== null && c.spent > c.limit;
        return (
          <div key={c.name} style={{ marginTop: 18 }}>
            <div className="row" style={{ padding: 0, minHeight: 0, borderTop: 0 }}>
              <span className="grow ellipsis">{c.name}</span>
              <span className={over ? "meta danger" : "meta"}>
                {fmtAmount(c.spent, d.base_currency)}
                {c.limit !== null && <> из {fmtAmount(c.limit, d.base_currency)}</>}
              </span>
            </div>
            {c.limit !== null && <Meter value={c.spent / c.limit} over={over} label={`Лимит ${c.name}`} />}
            <div className="row-2" style={{ marginTop: 8 }}>
              <input className="composer-input" inputMode="decimal" value={value} placeholder="без лимита"
                disabled={busy !== null} onChange={(e) => setEdit((s) => ({ ...s, [c.name]: e.target.value }))} />
              <button type="button" className="btn ghost" style={{ minHeight: 44 }}
                disabled={busy !== null || !dirty} onClick={() => void save(c.name, value)}>
                {busy === c.name ? "…" : "ОК"}
              </button>
            </div>
          </div>
        );
      })}
      {d.categories.length === 0 && <div className="sub">В этом месяце трат по категориям ещё нет.</div>}
    </>
  );

  return (
    <Sheet title="Лимиты по категориям" kicker={monthTitle(month)} onClose={onClose}>
      {loading && !data ? <div className="sub">Загрузка…</div>
        : error || !data ? <div className="sub danger">Не удалось загрузить.</div>
        : body(data)}
      {failed && <div className="sub danger">{failed}</div>}
    </Sheet>
  );
}
