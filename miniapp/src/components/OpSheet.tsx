import { useEffect, useState } from "react";
import type { Api } from "../api";
import { fmtAmount, fmtDayTitle, fmtRateNote, fmtNumber } from "../format";
import { buildPatch, editableAmount } from "../opEdit";
import { confirmDialog, hapticResult } from "../telegram";
import type { Categories, Operation } from "../types";

type Props = { api: Api; op: Operation; base: string; onClose: () => void; onSaved: () => void };

export function OpSheet({ api, op, base, onClose, onSaved }: Props) {
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
    return () => {
      alive = false;
    };
  }, [api]);

  const patch = buildPatch(op, { amount, title, category });
  const options = cats ? cats[op.type] : [];
  const choices = options.includes(op.category) ? options : [op.category, ...options];

  async function run(action: () => Promise<void>) {
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

  const save = () => {
    if (patch && patch !== "invalid") void run(() => api.updateTransaction(op.id, patch));
  };
  const remove = async () => {
    if (await confirmDialog("Удалить эту операцию?")) void run(() => api.deleteTransaction(op.id));
  };

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-label="Операция" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="sub">{fmtDayTitle(op.date)} · {op.type === "income" ? "доход" : "расход"}</span>
          <button type="button" className="sheet-close" onClick={onClose} disabled={busy} aria-label="Закрыть">✕</button>
        </div>

        <label className="field">
          <span>Сумма{edit.currency && `, ${edit.currency}`}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} />
        </label>
        {op.orig && (
          <div className="sub">
            Было: {fmtRateNote(op.orig, base)} = {fmtAmount(op.amount, base)}. Пересчитаю по тому же курсу.
          </div>
        )}

        <label className="field">
          <span>Название</span>
          <input value={title} placeholder={op.category} maxLength={200} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        </label>

        <div className="field">
          <span>Категория</span>
          <div className="chips">
            {choices.map((c) => (
              <button type="button" key={c} className={c === category ? "pill done" : "pill"} aria-pressed={c === category}
                onClick={() => setCategory(c)} disabled={busy}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {patch === "invalid" && <div className="danger sub">Проверь сумму и название.</div>}
        {error && <div className="danger sub">{error}</div>}

        <button type="button" className="button wide" onClick={save} disabled={busy || !patch || patch === "invalid"}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="button wide ghost-danger" onClick={remove} disabled={busy}>
          Удалить
        </button>
      </div>
    </div>
  );
}
