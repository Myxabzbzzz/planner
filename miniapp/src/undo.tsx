import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { hapticResult, tap } from "./telegram";

/**
 * Отмена удаления.
 *
 * Раньше любое удаление было безвозвратным: один `confirm` — и запись исчезала
 * вместе с историей (а кнопка «🗑 Удалить всё» под сводкой в чате сносила сразу
 * несколько записей вообще без подтверждения). Теперь удаление мягкое, а здесь
 * живёт полоска «Отменить» на несколько секунд.
 *
 * Диалог-подтверждение при этом убран: подтверждать и потом ещё иметь undo —
 * двойная работа. Опасное действие теперь обратимо, а не защищено вопросом.
 */
export const UNDO_MS = 8000;

type Offer = { id: number; text: string; undo: () => Promise<unknown> };

type UndoApi = {
  /** Показать «Отменить» после удаления. `undo` должен вернуть запись обратно. */
  offer: (text: string, undo: () => Promise<unknown>) => void;
};

const Ctx = createContext<UndoApi>({ offer: () => {} });

export const useUndo = () => useContext(Ctx);

export function UndoProvider({ onRestored, children }: { onRestored: () => void; children: ReactNode }) {
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const restored = useRef(onRestored);
  restored.current = onRestored;

  const api: UndoApi = {
    offer: useCallback((text, undo) => {
      seq.current += 1;
      setOffer({ id: seq.current, text, undo });
    }, []),
  };

  useEffect(() => {
    if (offer === null || busy) return;
    const t = setTimeout(() => setOffer((o) => (o?.id === offer.id ? null : o)), UNDO_MS);
    return () => clearTimeout(t);
  }, [offer, busy]);

  const run = async () => {
    if (offer === null || busy) return;
    tap();
    setBusy(true);
    try {
      await offer.undo();
      hapticResult(true);
      setOffer(null);
      restored.current();
    } catch {
      hapticResult(false);
      // Оставляем полоску на месте: вернуть запись можно попробовать ещё раз.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      {offer !== null && (
        <div className="undobar" role="status">
          <span className="grow">{offer.text}</span>
          <button type="button" className="undo-btn" onClick={() => void run()} disabled={busy}>
            {busy ? "Возвращаю…" : "Отменить"}
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
