import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../api";
import { MAX_TEXT, type Outcome, validText, waitForOutcome, waitingText } from "../composer";
import { fmtSeconds, MAX_BYTES, micSupported } from "../recorder";
import { hapticResult, tg } from "../telegram";
import type { Sent } from "../types";
import { useRecorder } from "../useRecorder";
import { IconClose, IconMic, IconSend, IconStop } from "./Icons";

export function Composer({ api, onDone }: { api: Api; onDone: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [clip, setClip] = useState<Blob | null>(null);
  const micOk = useMemo(() => micSupported({
    mediaDevices: navigator.mediaDevices,
    MediaRecorder: (window as unknown as { MediaRecorder?: { isTypeSupported?: (m: string) => boolean } }).MediaRecorder,
  }), []);
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
    if (!busy && validText(text)) void send(() => api.sendText(text.trim()), () => setText(""));
  };

  return (
    <div className="composer">
      {outcome && (
        <div className={`toast ${outcome.tone}`} onClick={() => setOutcome(null)}>
          <div>{outcome.text}</div>
          {outcome.tone === "review" && (
            <button type="button" className="button" onClick={() => tg?.close?.()}>Открыть чат</button>
          )}
        </div>
      )}
      {recorder.state === "recording" ? (
        <div className="composer-row">
          <button type="button" className="composer-btn ghost" onClick={() => recorder.stop(false)} aria-label="Отменить"><IconClose /></button>
          <span className="rec-dot" />
          <span className="grow">{fmtSeconds(recorder.seconds)} / 1:00</span>
          <button type="button" className="composer-btn" onClick={() => recorder.stop(true)} aria-label="Отправить запись"><IconStop /></button>
        </div>
      ) : (
        <form className="composer-row" onSubmit={(e) => { e.preventDefault(); submitText(); }}>
          <input className="composer-input" value={text} maxLength={MAX_TEXT} enterKeyHint="send"
            placeholder={showMic ? "Запиши или спроси…" : "Напиши или спроси (голосом — в чате бота)"}
            onChange={(e) => setText(e.target.value)} disabled={busy} />
          {text.trim() !== "" ? (
            <button type="submit" className="composer-btn" disabled={busy || !validText(text)} aria-label="Отправить"><IconSend /></button>
          ) : showMic && (
            <button type="button" className="composer-btn" disabled={busy} onClick={() => void recorder.start()} aria-label="Записать голос"><IconMic /></button>
          )}
        </form>
      )}
      {clip && !busy && recorder.state === "idle" && (
        <button type="button" className="pill" onClick={() => sendClip(clip)}>↻ Отправить запись ещё раз</button>
      )}
      {recorder.denied && <div className="composer-status sub">Нет доступа к микрофону. Голосом — в чате бота.</div>}
      {status && <div className="composer-status sub">{status}</div>}
    </div>
  );
}
