import { useState, type ReactNode } from "react";
import type { Api } from "../api";
import { parseAmount } from "../opEdit";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import { Sheet } from "./Sheet";

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="field"><span>{label}</span>{children}</label>
);

/** Добавить регулярный платёж вручную: что, сколько и какого числа списывается. */
export function RegularSheet({ api, currency, onClose, onSaved }: {
  api: Api; currency: string; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sum = parseAmount(amount);
  const dayNum = Number(day);
  const ok = title.trim() !== "" && sum !== null && sum > 0 && Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31;

  async function save() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.addRegular({ title: title.trim(), amount: sum!, day: dayNum });
      hapticResult(true);
      onSaved();
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Регулярный платёж" busy={busy} dirty={title !== "" || amount !== ""} onClose={onClose} footer={
      <>
        {error && <div className="sub danger">{error}</div>}
        <button type="button" className="btn wide block" disabled={busy || !ok} onClick={() => void save()}>
          {busy ? "Сохраняю…" : "Добавить"}
        </button>
      </>
    }>
      <Field label="Что">
        <input value={title} maxLength={200} autoFocus disabled={busy} placeholder="Яндекс Плюс"
          onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div className="row-2">
        <Field label={`Сумма, ${currency}`}>
          <input inputMode="decimal" value={amount} disabled={busy} placeholder="0"
            onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Число месяца">
          <input inputMode="numeric" value={day} disabled={busy} placeholder="5" maxLength={2}
            onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="card-foot">Накануне списания бот напомнит и по кнопке запишет трату.</div>
    </Sheet>
  );
}
