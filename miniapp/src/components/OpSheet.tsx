import { useEffect, useState } from "react";
import type { Api } from "../api";
import { fmtAmount, fmtDayTitle, fmtNumber, fmtRateNote } from "../format";
import { buildPatch, editableAmount } from "../opEdit";
import { confirmDialog, hapticResult } from "../telegram";
import type { Categories, Operation } from "../types";
import { Sheet } from "./Sheet";

export function OpSheet({ api, op, base, onClose, onSaved }: {
  api: Api; op: Operation; base: string; onClose: () => void; onSaved: () => void;
}) {
  const edit = editableAmount(op, base);
  const [amount, setAmount] = useState(fmtNumber(edit.amount));
  const [title, setTitle] = useState(op.title);
  const [category, setCategory] = useState(op.category);
  const [cats, setCats] = useState<Categories | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.categories().then((c) => alive && setCats(c)).catch(() => alive && setCats({ expense: [], income: [] }));
    return () => { alive = false; };
  }, [api]);

  const patch = buildPatch(op, { amount, title, category });
  const options = cats ? cats[op.type] : [];
  const choices = options.includes(op.category) ? options : [op.category, ...options];

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      hapticResult(true);
      onSaved();
    } catch {
      hapticResult(false);
      setError("Не удалось сохранить. Попробуй ещё раз.");
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={op.type === "income" ? "Доход" : "Расход"}
      kicker={fmtDayTitle(op.date)}
      busy={busy}
      dirty={patch !== null}
      onClose={onClose}
      footer={
        <>
          {patch === "invalid" && <div className="sub danger">Проверь сумму и название.</div>}
          {error && <div className="sub danger">{error}</div>}
          <button type="button" className="btn wide block" disabled={busy || !patch || patch === "invalid"}
            onClick={() => { if (patch && patch !== "invalid") void run(() => api.updateTransaction(op.id, patch)); }}>
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
          <button type="button" className="btn wide danger-text" disabled={busy}
            onClick={async () => {
              if (await confirmDialog("Удалить эту операцию?")) void run(() => api.deleteTransaction(op.id));
            }}>
            Удалить операцию
          </button>
        </>
      }
    >
      <label className="field">
        <span>Сумма{edit.currency && `, ${edit.currency}`}</span>
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
      </label>
      {op.orig && (
        <div className="card-foot">
          Было: {fmtRateNote(op.orig, base)} = {fmtAmount(op.amount, base)}. Пересчитаю по тому же курсу.
        </div>
      )}

      <label className="field">
        <span>Название</span>
        <input value={title} placeholder={op.category} maxLength={200}
          onChange={(e) => setTitle(e.target.value)} disabled={busy} />
      </label>

      <div className="field">
        <span>Категория</span>
        <div className="chips">
          {choices.map((c) => (
            <button type="button" key={c} className={c === category ? "pill on" : "pill"}
              aria-pressed={c === category} onClick={() => setCategory(c)} disabled={busy}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
