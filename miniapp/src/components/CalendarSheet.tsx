import { useState } from "react";
import type { Api } from "../api";
import { googleSubscribe } from "../calendarLinks";
import { useLoad } from "../load";
import { saveError } from "../saveError";
import { confirmDialog, hapticResult, openPage } from "../telegram";
import { ProTeaser } from "./ProTeaser";
import { ErrorCard, Loading } from "./States";
import { Sheet } from "./Sheet";

/**
 * Подписка на календарь (Pro): встречи и дела из планера появляются в календаре
 * iPhone или Google и обновляются сами. Ссылка секретная — её можно сбросить.
 */
export function CalendarSheet({ api, onClose, onPro }: { api: Api; onClose: () => void; onPro: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.calendar(), [api]);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const link = url ?? (data && "url" in data ? data.url : null);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      hapticResult(true);
      setCopied(true);
    } catch {
      // в части WebView буфер обмена закрыт — тогда ссылка видна ниже, её можно выделить
      setNote("Не получилось скопировать — выдели ссылку ниже и скопируй вручную.");
    }
  }

  async function reset() {
    if (!await confirmDialog("Сделать новую ссылку? По старой календари перестанут обновляться — подписаться нужно будет заново.")) return;
    setBusy(true);
    setNote(null);
    try {
      setUrl((await api.resetCalendar()).url);
      setCopied(false);
      hapticResult(true);
      setNote("Готово: старая ссылка больше не работает.");
    } catch (e) {
      hapticResult(false);
      setNote(saveError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Календарь" busy={busy} onClose={onClose}>
      {loading && !data && <Loading />}
      {!!error && !data && <ErrorCard onRetry={reload} />}
      {data && "locked" in data && (
        <>
          <div className="sub" style={{ marginTop: 0 }}>
            Встречи и дела из планера — прямо в календаре iPhone или Google. Обновляются сами.
          </div>
          <ProTeaser title="Подписка на календарь" hint="Доступна в Pro" onPro={onPro} />
        </>
      )}
      {link && (
        <>
          <div className="sub" style={{ marginTop: 0 }}>
            Встречи и дела со сроком появятся в твоём календаре и будут обновляться сами — обычно в течение пары часов.
          </div>
          <button type="button" className="btn wide block" onClick={() => openPage(googleSubscribe(link))}>
            Добавить в Google Календарь
          </button>
          <button type="button" className="btn ghost wide block" onClick={() => void copy()}>
            {copied ? "Ссылка скопирована" : "Скопировать ссылку для iPhone"}
          </button>
          <div className="card-foot">
            На iPhone: Настройки → Приложения → Календарь → Учётные записи → Добавить → Другое →
            Подписной календарь → вставь ссылку.
          </div>
          <input className="mono-link" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Ссылка на календарь" />
          <div className="chips" style={{ marginTop: 16 }}>
            <button type="button" className="pill" disabled={busy} onClick={() => void reset()}>Сделать новую ссылку</button>
          </div>
          <div className="card-foot">Ссылка личная: по ней видны твои встречи. Если кому-то отправил её по ошибке — сделай новую.</div>
        </>
      )}
      {note && <div className="sub">{note}</div>}
    </Sheet>
  );
}
