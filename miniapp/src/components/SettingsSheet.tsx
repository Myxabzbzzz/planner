import { useState } from "react";
import { needsPro, type Api } from "../api";
import { fmtAmount, fmtNumber } from "../format";
import { parseAmount } from "../opEdit";
import { saveError } from "../saveError";
import { type Accent, hapticResult, setAppearance, type ThemePref } from "../telegram";
import type { NotifyKind, Settings } from "../types";
import { Sheet } from "./Sheet";
import { Switch } from "./Switch";

const NOTIFY: { key: NotifyKind; label: string; hint: string }[] = [
  { key: "reminders", label: "Напоминания о встречах", hint: "за 30 минут до начала" },
  { key: "daily", label: "Итоги дня", hint: "каждый вечер в 21:30" },
  { key: "weekly", label: "Итоги недели", hint: "в воскресенье в 21:30" },
];

const THEMES: { key: ThemePref; label: string }[] = [
  { key: "auto", label: "Как в Telegram" },
  { key: "light", label: "Светлая" },
  { key: "dark", label: "Тёмная" },
];
const ACCENTS: { key: Accent; label: string }[] = [
  { key: "amber", label: "Янтарь" },
  { key: "ocean", label: "Океан" },
  { key: "mint", label: "Мята" },
  { key: "berry", label: "Ягода" },
  { key: "violet", label: "Фиалка" },
];

/**
 * Настройки в мини-аппе. Раньше часовой пояс, лимит и уведомления жили только
 * в кнопках чата, хотя лимит — центральная цифра экрана «Деньги»:
 * увидеть его было можно, а изменить — нет.
 */
export function SettingsSheet({ api, settings, onClose, onChanged, onAccount, onPro }: {
  api: Api;
  settings: Settings;
  onClose: () => void;
  onChanged: (s: Settings) => void;
  onAccount: () => void;
  /** оформление — Pro */
  onPro: () => void;
}) {
  const [limit, setLimit] = useState(settings.limit === null ? "" : fmtNumber(settings.limit));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parsed = limit.trim() === "" ? 0 : parseAmount(limit);
  const limitOk = parsed !== null;
  const current = settings.limit ?? 0;
  const dirty = limitOk && parsed !== current;

  const theme = settings.theme ?? "auto";
  const accent = settings.accent ?? "amber";

  /** Видно сразу; не Pro — откатываем и показываем, что даёт Pro. */
  async function appearance(nextTheme: ThemePref, nextAccent: Accent) {
    const was = { theme, accent };
    setAppearance({ theme: nextTheme, accent: nextAccent });
    setBusy(true);
    setError(null);
    try {
      await api.setAppearance(nextTheme, nextAccent);
      hapticResult(true);
      onChanged({ ...settings, theme: nextTheme, accent: nextAccent });
    } catch (e) {
      hapticResult(false);
      setAppearance(was);
      if (needsPro(e)) onPro();
      else setError(saveError(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<unknown>, next: Settings) {
    setBusy(true);
    setError(null);
    try {
      await run();
      hapticResult(true);
      onChanged(next);
      setSaved(true);
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Настройки" busy={busy} dirty={dirty} onClose={onClose}>
      <label className="field">
        <span>Лимит на месяц, {settings.base_currency}</span>
        <input inputMode="decimal" value={limit} disabled={busy} placeholder="без лимита"
          onChange={(e) => { setLimit(e.target.value); setSaved(false); }} />
      </label>
      <div className="card-foot">
        {parsed === 0
          ? "Пусто или 0 — лимита нет, и прогресс на «Деньгах» не показывается."
          : limitOk
          ? `Покажу, сколько осталось из ${fmtAmount(parsed, settings.base_currency)}.`
          : "Не похоже на сумму."}
      </div>
      <button type="button" className="btn wide block" disabled={busy || !dirty}
        onClick={() => void act(() => api.setLimit(parsed as number), { ...settings, limit: parsed === 0 ? null : (parsed as number) })}>
        {busy ? "Сохраняю…" : "Сохранить лимит"}
      </button>

      <div className="field" style={{ marginTop: 24 }}><span>Уведомления в чат</span></div>
      {NOTIFY.map((n) => {
        const on = settings[`notify_${n.key}` as const];
        return (
          <Switch key={n.key} on={on} label={n.label} hint={n.hint} disabled={busy}
            onToggle={() => void act(() => api.setNotify(n.key, !on), { ...settings, [`notify_${n.key}`]: !on } as Settings)} />
        );
      })}

      <div className="field" style={{ marginTop: 24 }}><span>Оформление · Pro</span></div>
      <div className="chips">
        {THEMES.map((t) => (
          <button type="button" key={t.key} className={t.key === theme ? "pill on" : "pill"} aria-pressed={t.key === theme}
            disabled={busy} onClick={() => void appearance(t.key, accent)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="accent-picks" role="radiogroup" aria-label="Цвет акцента">
        {ACCENTS.map((a) => (
          <button type="button" key={a.key} role="radio" aria-checked={a.key === accent} aria-label={a.label}
            className={a.key === accent ? "accent-pick on" : "accent-pick"} data-accent-pick={a.key} disabled={busy}
            onClick={() => void appearance(theme, a.key)}>
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 24 }}><span>Аккаунт</span></div>
      <button type="button" className="row" style={{ width: "100%" }} onClick={onAccount} disabled={busy}>
        <span className="grow row-title" style={{ minHeight: 0 }}>
          Валюта, выгрузка, удаление
          <span className="row-sub">базовая валюта сейчас — {settings.base_currency}</span>
        </span>
      </button>
      <div className="row">
        <span className="grow">Часовой пояс</span>
        <span className="meta">{settings.tz}</span>
      </div>
      <div className="card-foot">Часовой пояс меняется в «⚙️ Настройки» у бота.</div>

      {error && <div className="sub danger">{error}</div>}
      {saved && !error && <div className="sub">Сохранено.</div>}
    </Sheet>
  );
}
