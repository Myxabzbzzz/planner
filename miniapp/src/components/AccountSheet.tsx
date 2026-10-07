import { useState } from "react";
import type { Api } from "../api";
import { fmtAmount } from "../format";
import { saveError } from "../saveError";
import { confirmDialog, hapticResult } from "../telegram";
import type { CurrencyChange, Settings } from "../types";
import { Sheet } from "./Sheet";

const COMMON = ["UZS", "RUB", "USD", "EUR", "KZT"];

/**
 * Валюта, выгрузка и удаление аккаунта.
 *
 * Базовую валюту нельзя было изменить никогда — бот прямо писал «потом её
 * не поменять». Человек из Ташкента, тапнувший USD вместо UZS на первом экране,
 * получал год неверных сумм и бессмысленный лимит без единого выхода: ни смены
 * валюты, ни экспорта, ни удаления аккаунта во всём проекте не было.
 */
export function AccountSheet({ api, settings, onClose, onChanged }: {
  api: Api;
  settings: Settings;
  onClose: () => void;
  onChanged: (s: Settings) => void;
}) {
  const [currency, setCurrency] = useState(settings.base_currency);
  const [busy, setBusy] = useState<null | "currency" | "export" | "delete">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CurrencyChange | null>(null);
  const choices = COMMON.includes(currency) ? COMMON : [currency, ...COMMON];
  const changed = currency !== settings.base_currency;

  async function changeCurrency() {
    const ok = await confirmDialog(
      `Пересчитать всю историю из ${settings.base_currency} в ${currency}? ` +
        "Суммы пересчитаются по курсам на даты операций.",
    );
    if (!ok) return;
    setBusy("currency");
    setError(null);
    try {
      const r = await api.changeCurrency(currency);
      hapticResult(true);
      setResult(r);
      onChanged({ ...settings, base_currency: r.to });
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
    } finally {
      setBusy(null);
    }
  }

  async function exportAll() {
    setBusy("export");
    setError(null);
    try {
      const data = await api.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `planner-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      hapticResult(true);
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
    } finally {
      setBusy(null);
    }
  }

  async function removeAccount() {
    if (!await confirmDialog("Удалить аккаунт и все записи? Это навсегда.")) return;
    if (!await confirmDialog("Точно? Отменить это будет нельзя. Сначала лучше выгрузить данные.")) return;
    setBusy("delete");
    setError(null);
    try {
      await api.deleteAccount();
      hapticResult(true);
      // Больше показывать нечего — закрываем приложение.
      window.location.reload();
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
      setBusy(null);
    }
  }

  return (
    <Sheet title="Аккаунт" busy={busy !== null} onClose={onClose}>
      <div className="field">
        <span>Базовая валюта</span>
        <div className="chips">
          {choices.map((c) => (
            <button type="button" key={c} className={c === currency ? "pill on" : "pill"}
              aria-pressed={c === currency} disabled={busy !== null} onClick={() => setCurrency(c)}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="card-foot">
        {changed
          ? `Все операции пересчитаются из ${settings.base_currency} в ${currency} по курсам на их даты. Лимит тоже.`
          : "В ней считаются все итоги и лимиты."}
      </div>
      {changed && (
        <button type="button" className="btn wide block" disabled={busy !== null} onClick={() => void changeCurrency()}>
          {busy === "currency" ? "Пересчитываю…" : `Перейти на ${currency}`}
        </button>
      )}
      {result && (
        <div className="sub">
          Пересчитано операций: {result.converted}.
          {result.skipped > 0 && (
            <> Без курса осталось {result.skipped} — они не тронуты, чтобы не записать неверную сумму.</>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 24 }}><span>Данные</span></div>
      <button type="button" className="btn ghost wide" disabled={busy !== null} onClick={() => void exportAll()}>
        {busy === "export" ? "Собираю…" : "Выгрузить всё в файл"}
      </button>
      <div className="card-foot">
        Задачи, встречи, операции, заметки и привычки одним JSON — на случай, если захочешь уйти или просто сохранить.
      </div>

      <div className="field" style={{ marginTop: 24 }}><span>Опасная зона</span></div>
      <button type="button" className="btn wide danger-text" disabled={busy !== null} onClick={() => void removeAccount()}>
        {busy === "delete" ? "Удаляю…" : "Удалить аккаунт и все записи"}
      </button>
      <div className="card-foot">
        Лимит на месяц сейчас: {settings.limit === null ? "не задан" : fmtAmount(settings.limit, settings.base_currency)}.
      </div>

      {error && <div className="sub danger">{error}</div>}
    </Sheet>
  );
}
