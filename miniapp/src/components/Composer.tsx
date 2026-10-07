import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../api";
import { MAX_TEXT, type Outcome, validText, waitForOutcome, waitingText } from "../composer";
import { fmtSeconds, MAX_BYTES, micSupported } from "../recorder";
import { hapticResult, tap, tg } from "../telegram";
import type { Sent } from "../types";
import { useRecorder } from "../useRecorder";
import { IconClose, IconMic, IconPlus, IconSend, IconStop } from "./Icons";

/**
 * Быстрый ввод: пишешь или говоришь, разбирает ИИ.
 *
 * Док стал в полтора раза ниже (поле 44 px вместо 48 + ряд кнопок), потому что
 * раньше он съедал 176 px экрана. Кнопка «+» рядом открывает ручное добавление —
 * оно работает, даже когда ИИ-воркер спит.
 */
export function Composer({ api, onDone, onAdd }: { api: Api; onDone: () => void; onAdd: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const micOk = useMemo(
    () =>
      micSupported({
        mediaDevices: navigator.mediaDevices,
        MediaRecorder: (window as unknown as { MediaRecorder?: { isTypeSupported?: (m: string) => boolean } })
          .MediaRecorder,
      }),
    [],
  );
  const sendClip = (blob: Blob) => void send(() => api.sendAudio(blob), () => setClip(null));
  const recorder = useRecorder((blob) => {
    if (blob.size > MAX_BYTES) {
      setStatus("Запись слишком большая — до 60 секунд.");
      return;
    }
    setClip(blob);
    sendClip(blob);
  });
  const showMic = micOk && !recorder.denied;
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (outcome?.tone !== "ok") return;
    const t = setTimeout(() => setOutcome(null), 6000);
    return () => clearTimeout(t);
  }, [outcome]);

  async function follow(sent: Sent) {
    setStatus(waitingText(sent.worker_online));
    const o = await waitForOutcome((id) => api.inboxStatus(id), sent.id, {
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      alive: () => alive.current,
    });
    if (!o || !alive.current) return;
    setStatus(null);
    setOutcome(o);
    hapticResult(o.tone === "ok");
    if (o.tone === "ok") onDone();
  }

  async function send(submit: () => Promise<Sent>, onSent?: () => void) {
    setBusy(true);
    setOutcome(null);
    setStatus(null);
    try {
      const sent = await submit();
      onSent?.();
      setBusy(false);
      void follow(sent);
    } catch {
      setBusy(false);
      setStatus("Не отправилось. Попробуй ещё раз.");
    }
  }

  const submitText = () => {
    if (!busy && validText(text)) {
      tap();
      void send(() => api.sendText(text.trim()), () => setText(""));
    }
  };

  return (
    <div>
      {outcome && (
        <div className={`toast ${outcome.tone}`} role="status">
          <div className="row" style={{ minHeight: 0, padding: 0, alignItems: "flex-start" }}>
            <div className="grow">{outcome.text}</div>
            {outcome.tone !== "ok" && (
              <button type="button" className="icon-btn" style={{ width: 32, height: 32 }}
                onClick={() => setOutcome(null)} aria-label="Скрыть">
                <IconClose size={14} />
              </button>
            )}
          </div>
          {/* Уточнение пока разбирается только в чате — честно говорим, куда идти */}
          {outcome.tone === "review" && (
            <button type="button" className="btn wide" onClick={() => tg?.close?.()}>Открыть чат бота</button>
          )}
        </div>
      )}

      {recorder.state === "recording" ? (
        <div className="composer-row">
          <button type="button" className="round ghost" onClick={() => recorder.stop(false)} aria-label="Отменить запись">
            <IconClose />
          </button>
          <span className="rec-dot" aria-hidden="true" />
          <span className="grow num">{fmtSeconds(recorder.seconds)} / 1:00</span>
          <button type="button" className="round" onClick={() => recorder.stop(true)} aria-label="Отправить запись">
            <IconStop />
          </button>
        </div>
      ) : (
        <form className="composer-row" onSubmit={(e) => { e.preventDefault(); submitText(); }}>
          <button type="button" className="round ghost" onClick={() => { tap(); onAdd(); }} aria-label="Добавить вручную">
            <IconPlus />
          </button>
          <input
            className="composer-input"
            value={text}
            maxLength={MAX_TEXT}
            enterKeyHint="send"
            placeholder={showMic ? "Запиши или спроси…" : "Напиши или спроси…"}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            aria-label="Быстрая запись"
          />
          {text.trim() !== "" ? (
            <button type="submit" className="round" disabled={busy || !validText(text)} aria-label="Отправить">
              <IconSend />
            </button>
          ) : showMic ? (
            <button type="button" className="round" disabled={busy} onClick={() => void recorder.start()} aria-label="Записать голос">
              <IconMic />
            </button>
          ) : null}
        </form>
      )}

      {clip && !busy && recorder.state === "idle" && (
        <button type="button" className="pill" style={{ marginTop: 8 }} onClick={() => sendClip(clip)}>
          Отправить запись ещё раз
        </button>
      )}
      {recorder.denied && <div className="composer-note">Нет доступа к микрофону — можно написать текстом.</div>}
      {status && <div className="composer-note">{status}</div>}
    </div>
  );
}
