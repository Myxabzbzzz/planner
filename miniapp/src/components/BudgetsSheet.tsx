import { useState } from "react";
import type { Api } from "../api";
import { fmtAmount, fmtNumber, monthTitle } from "../format";
import { parseAmount } from "../opEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import { catColor } from "../charts";
import { CATEGORY_COLORS, type BudgetsResp, type CategoryColor } from "../types";
import { useLoad } from "../load";
import { Meter } from "./Meter";
import { Sheet } from "./Sheet";

const COLOR_NAMES: Record<CategoryColor, string> = {
  blue: "синий", orange: "оранжевый", aqua: "бирюзовый", yellow: "жёлтый",
  magenta: "розовый", green: "зелёный", violet: "фиолетовый", red: "красный",
};

/**
 * Лимиты и цвета категорий.
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
  // Цвет меняется по id категории, а api_budgets отдаёт только имена — id берём из списка категорий.
  const cats = useLoad(() => api.categories().catch(() => null), [api]);
  const [picking, setPicking] = useState<string | null>(null);
  const [painted, setPainted] = useState<Record<string, CategoryColor | null>>({});
  const categoryOf = (name: string) => cats.data?.expense.find((c) => c.name === name);
  const colorOf = (name: string) => (name in painted ? painted[name] : categoryOf(name)?.color ?? null);

  const paint = async (name: string, color: CategoryColor | null) => {
    const cat = categoryOf(name);
    if (!cat) return;
    setBusy(name);
    setFailed(null);
    try {
      await api.setCategoryColor(cat.id, color);
      hapticResult(true);
      setPainted((p) => ({ ...p, [name]: color }));
      setPicking(null);
      onChanged();
    } catch (e) {
      hapticResult(false);
      setFailed(saveError(e));
    } finally {
      setBusy(null);
    }
  };

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
      <div className="card-foot">
        Потрачено за {monthTitle(month).toLowerCase()}. Пусто или 0 — лимита нет.
        Нажми на кружок, чтобы выбрать категории цвет.
      </div>
      {d.categories.map((c) => {
        const value = edit[c.name] ?? (c.limit === null ? "" : fmtNumber(c.limit));
        const dirty = edit[c.name] !== undefined;
        const over = c.limit !== null && c.spent > c.limit;
        return (
          <div key={c.name} style={{ marginTop: 18 }}>
            <div className="row" style={{ padding: 0, minHeight: 0, borderTop: 0 }}>
              <button type="button" className={colorOf(c.name) ? "color-dot filled" : "color-dot"} aria-expanded={picking === c.name}
                aria-label={`Цвет категории ${c.name}`} disabled={busy !== null || !categoryOf(c.name)}
                style={{ background: catColor(colorOf(c.name)) ?? undefined }}
                onClick={() => setPicking((p) => (p === c.name ? null : c.name))} />
              <span className="grow ellipsis">{c.name}</span>
              <span className={over ? "meta danger" : "meta"}>
                {fmtAmount(c.spent, d.base_currency)}
                {c.limit !== null && <> из {fmtAmount(c.limit, d.base_currency)}</>}
              </span>
            </div>
            {picking === c.name && (
              <div className="palette" role="group" aria-label={`Цвет категории ${c.name}`}>
                <button type="button" className="color-dot auto" aria-pressed={colorOf(c.name) === null}
                  aria-label="Без цвета — по месту в рейтинге" disabled={busy !== null}
                  onClick={() => void paint(c.name, null)} />
                {CATEGORY_COLORS.map((k) => (
                  <button type="button" key={k} className="color-dot filled" aria-pressed={colorOf(c.name) === k}
                    aria-label={COLOR_NAMES[k]} disabled={busy !== null}
                    style={{ background: catColor(k)! }} onClick={() => void paint(c.name, k)} />
                ))}
              </div>
            )}
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
    <Sheet title="Лимиты и цвета" kicker={monthTitle(month)} onClose={onClose}>
      {loading && !data ? <div className="sub">Загрузка…</div>
        : error || !data ? <div className="sub danger">Не удалось загрузить.</div>
        : body(data)}
      {failed && <div className="sub danger">{failed}</div>}
    </Sheet>
  );
}
