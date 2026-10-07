import { useRef, useState } from "react";
import { thud } from "../telegram";

/**
 * Марка: три полосы убывающей высоты. Читается как столбики прогресса —
 * и это же полосы тигра. Единственная заметная отсылка; всё остальное мельче.
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect width="48" height="48" rx="12" fill="var(--surface-2)" />
      <g fill="var(--accent)">
        <rect x="12" y="28" width="6" height="10" rx="3" />
        <rect x="21" y="20" width="6" height="18" rx="3" />
        <rect x="30" y="10" width="6" height="28" rx="3" />
      </g>
    </svg>
  );
}

/**
 * Пасхалка: долгий тап по марке — один янтарный блик-полоса через экран.
 * Нигде не подсказывается и ничего не меняет.
 */
export function Masthead({ name, onProfile }: { name: string; onProfile: () => void }) {
  const [sweep, setSweep] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const start = () => {
    timer.current = window.setTimeout(() => {
      thud();
      setSweep(true);
      window.setTimeout(() => setSweep(false), 900);
    }, 700);
  };
  const cancel = () => window.clearTimeout(timer.current);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <header className="masthead">
      <button
        type="button"
        aria-label="Планер"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mark size={30} />
      </button>
      <span className="wordmark">
        <span className="wm-name">Планер</span>
        <span className="wm-sub">вся жизнь в одном месте</span>
      </span>
      <button type="button" className="avatar" onClick={onProfile} aria-label="Профиль">{initial}</button>
      {sweep && <div className="stripe-sweep" aria-hidden="true" />}
    </header>
  );
}
