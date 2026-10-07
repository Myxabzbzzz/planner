import { useState } from "react";
import type { Api } from "../api";
import { Card, Empty, ErrorCard, Loading } from "../components/States";
import { fmtShortDate, fmtTime } from "../format";
import { useLoad } from "../load";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import type { ReviewKind } from "../types";

/**
 * Открытые вопросы ИИ.
 *
 * Раньше уточнение жило только в чате: миниапп показывал «❓ Нужно уточнить —
 * открой чат» и закрывался. Если человек отвлёкся, запись оставалась в подвешенном
 * состоянии навсегда — ни списка, ни напоминания. Теперь на вопрос можно ответить
 * здесь же, одним тапом.
 */
export function Reviews({ api, refresh = 0, onDone }: {
  api: Api; refresh?: number; onDone: () => void;
}) {
  const { data, error, loading, reload } = useLoad(() => api.reviews(), [api], refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const answer = async (inboxId: string, index: number, choice: string, kind: ReviewKind) => {
    const key = `${inboxId}:${index}`;
    setBusy(key);
    setFailed(null);
    try {
      await api.answerReview(inboxId, index, choice, kind);
      hapticResult(true);
      reload();
      onDone();
    } catch (e) {
      hapticResult(false);
      setFailed(saveError(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorCard onRetry={reload} />;
  if (data.reviews.length === 0) {
    return <Empty title="Всё разобрано" hint="Вопросов от ИИ сейчас нет" />;
  }

  return (
    <>
      <p className="dateline">
        {data.reviews.length === 1 ? "Один вопрос" : `Вопросов: ${data.reviews.length}`} — ответь, и запись сохранится
      </p>
      {data.reviews.map((r) => {
        const key = `${r.inbox_id}:${r.index}`;
        return (
          <Card key={key}>
            <div className="note-meta">
              <span>{fmtShortDate(r.created_at)}, {fmtTime(r.created_at)}</span>
            </div>
            <div className="note-text">«{r.source_text}»</div>
            <div className="sub">{r.question}</div>
            <div className="chips" style={{ marginTop: 12 }}>
              {r.options.map((o) => (
                <button type="button" key={o.key} className="pill" disabled={busy !== null}
                  onClick={() => void answer(r.inbox_id, r.index, o.key, r.kind)}>
                  {busy === key ? "…" : o.label}
                </button>
              ))}
            </div>
          </Card>
        );
      })}
      {failed && <div className="sub danger">{failed}</div>}
    </>
  );
}
