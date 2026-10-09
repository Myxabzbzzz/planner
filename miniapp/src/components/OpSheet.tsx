import { useEffect, useState } from "react";
import type { Api } from "../api";
import { fmtAmount, fmtDayTitle, fmtNumber, fmtRateNote } from "../format";
import { buildEdit, type OpFullForm } from "../opEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import type { Categories, Operation } from "../types";
import { useUndo } from "../undo";
import { Sheet } from "./Sheet";

/** Чаще всего нужные; любую другую можно вписать руками. */
const COMMON = ["UZS", "RUB", "USD", "EUR", "KZT"];

const TYPES: { key: "expense" | "income"; label: string }[] = [
  { key: "expense", label: "Расход" },
  { key: "income", label: "Доход" },
];

export function OpSheet({ api, op, base, onClose, onSaved }: {
  api: Api; op: Operation; base: string; onClose: () => void; onSaved: () => void;
}) {
  const wasCurrency = op.orig?.currency ?? base;
  const [form, setForm] = useState<OpFullForm>({
    amount: fmtNumber(op.orig ? op.orig.amount : op.amount),
    title: op.title,
    category: op.category,
    date: op.date,
    type: op.type,
    currency: wasCurrency,
  });
  const set = <K extends keyof OpFullForm>(k: K, v: OpFullForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const [cats, setCats] = useState<Categories | null>(() => api.cachedCategories());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = useUndo();

  useEffect(() => {
    let alive = true;
    api.categories().then((c) => alive && setCats(c)).catch(() => alive && setCats({ expense: [], income: [] }));
    return () => { alive = false; };
  }, [api]);

  const patch = buildEdit(op, base, form);
  const options = cats ? cats[form.type].map((c) => c.name) : [];
  const choices = options.includes(form.category) ? options : [form.category, ...options];
  const currencies = COMMON.includes(form.currency) ? COMMON : [form.currency, ...COMMON];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      hapticResult(true);
      onSaved();
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
      setBusy(false);
    }
  }

  // Удаление мягкое, поэтому вместо диалога-подтверждения — «Отменить» на 8 секунд.
  const remove = () =>
    run(async () => {
      await api.deleteTransaction(op.id);
      undo.offer("Операция удалена", () => api.restoreTransaction(op.id));
    });

  return (
    <Sheet
      title={op.type === "income" ? "Доход" : "Расход"}
      kicker={fmtDayTitle(op.date)}
      busy={busy}
      dirty={patch !== null}
      onClose={onClose}
      footer={
        <>
          {patch === "invalid" && <div className="sub danger">Проверь сумму, дату, валюту и название.</div>}
          {error && <div className="sub danger">{error}</div>}
          <button type="button" className="btn wide block" disabled={busy || !patch || patch === "invalid"}
            onClick={() => { if (patch && patch !== "invalid") void run(() => api.editTransaction(op.id, patch)); }}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
          <button type="button" className="btn wide danger-text" disabled={busy} onClick={() => void remove()}>
            Удалить операцию
          </button>
        </>
      }
    >
      <div className="field">
        <span>Это</span>
        <div className="chips">
          {TYPES.map((t) => (
            <button type="button" key={t.key} className={t.key === form.type ? "pill on" : "pill"}
              aria-pressed={t.key === form.type} disabled={busy}
              onClick={() => { set("type", t.key); set("category", ""); }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="row-2">
        <label className="field">
          <span>Сумма</span>
          <input inputMode="decimal" value={form.amount} disabled={busy}
            onChange={(e) => set("amount", e.target.value)} />
        </label>
        <label className="field">
          <span>Дата</span>
          <input type="date" value={form.date} disabled={busy} onChange={(e) => set("date", e.target.value)} />
        </label>
      </div>

      <div className="field">
        <span>Валюта</span>
        <div className="chips">
          {currencies.map((c) => (
            <button type="button" key={c} className={c === form.currency ? "pill on" : "pill"}
              aria-pressed={c === form.currency} disabled={busy}
              onClick={() => set("currency", c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="card-foot">
        {form.currency === base
          ? `Сумма в ${base} — пересчитывать нечего.`
          : `Пересчитаю в ${base} по курсу на ${form.date}.`}
        {op.orig && form.currency === wasCurrency && form.date === op.date && (
          <> Было: {fmtRateNote(op.orig, base)} = {fmtAmount(op.amount, base)}.</>
        )}
      </div>

      <label className="field">
        <span>Название</span>
        <input value={form.title} placeholder={form.category || "необязательно"} maxLength={200} disabled={busy}
          onChange={(e) => set("title", e.target.value)} />
      </label>

      <div className="field">
        <span>Категория</span>
        <div className="chips">
          {choices.filter((c) => c !== "").map((c) => (
            <button type="button" key={c} className={c === form.category ? "pill on" : "pill"}
              aria-pressed={c === form.category} disabled={busy}
              onClick={() => set("category", c === form.category ? "" : c)}>
              {c}
            </button>
          ))}
        </div>
        <input value={form.category} maxLength={50} placeholder="или своя категория" disabled={busy}
          onChange={(e) => set("category", e.target.value)} />
      </div>
    </Sheet>
  );
}
