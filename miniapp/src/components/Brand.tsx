import { useRef, useState } from "react";
import { thud } from "../telegram";

/**
 * Марка «bars»: силуэт медведя, внутри три тигриные полосы. Полосы — не краска, а прорезь
 * цветом фона, поэтому марка сама подстраивается под тему (в public/logo-*.svg — по файлу на тему).
 */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <g fill="var(--accent)">
        <circle cx="12" cy="15" r="6.6" />
        <circle cx="36" cy="15" r="6.6" />
        <ellipse cx="24" cy="29" rx="16" ry="13.6" />
      </g>
      <g fill="var(--bg)">
        <rect x="15.4" y="19.5" width="4.4" height="10.5" rx="2.2" />
        <rect x="21.8" y="19.5" width="4.4" height="15" rx="2.2" />
        <rect x="28.2" y="19.5" width="4.4" height="10.5" rx="2.2" />
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
        aria-label="B&T Planner"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mark size={34} />
      </button>
      <span className="wordmark">
        <span className="wm-name">B&amp;T Planner</span>
        <span className="wm-sub">вся жизнь в одном месте</span>
      </span>
      <button type="button" className="avatar" onClick={onProfile} aria-label="Профиль">{initial}</button>
      {sweep && <div className="stripe-sweep" aria-hidden="true" />}
    </header>
  );
}
