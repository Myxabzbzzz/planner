import { useEffect, useRef, type ReactNode } from "react";
import { useBackButton, useCloseGuard } from "../telegram";
import { IconClose } from "./Icons";

/**
 * Общая оболочка шторки.
 *
 * Здесь закрываются три старые дыры:
 *  • системная «Назад» (и свайп назад на Android) закрывала весь миниапп вместе
 *    с несохранёнными правками — теперь закрывает только верхнюю шторку;
 *  • Telegram спрашивает подтверждение, пока в форме есть несохранённые изменения;
 *  • Esc и клик по фону работают одинаково, но не срабатывают во время сохранения.
 */
export function Sheet({ title, kicker, busy, dirty, onClose, children, footer }: {
  title: string;
  kicker?: string;
  busy?: boolean;
  dirty?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  const guarded = busy ? null : () => close.current();

  useBackButton(guarded);
  useCloseGuard(Boolean(dirty) && !busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  return (
    <div className="sheet-backdrop" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="grow">
            <div className="sheet-title">{title}</div>
            {kicker && <div className="sheet-kicker">{kicker}</div>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Закрыть">
            <IconClose />
          </button>
        </div>
        {children}
        {footer}
      </div>
    </div>
  );
}
