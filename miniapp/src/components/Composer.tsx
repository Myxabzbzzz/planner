import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import { MAX_TEXT, type Outcome, validText, waitForOutcome, waitingText } from "../composer";
import { hapticResult, tg } from "../telegram";
import type { Sent } from "../types";

export function Composer({ api, onDone }: { api: Api; onDone: () => void }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
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
      <form className="composer-row" onSubmit={(e) => { e.preventDefault(); submitText(); }}>
        <input className="composer-input" placeholder="Запиши или спроси…" value={text} maxLength={MAX_TEXT}
          enterKeyHint="send" onChange={(e) => setText(e.target.value)} disabled={busy} />
        {text.trim() !== "" && (
          <button type="submit" className="composer-btn" disabled={busy || !validText(text)} aria-label="Отправить">↑</button>
        )}
      </form>
      {status && <div className="composer-status sub">{status}</div>}
    </div>
  );
}
