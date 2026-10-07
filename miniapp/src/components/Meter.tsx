import type { ReactNode } from "react";

/** За лимитом полоса становится предупреждающей штриховкой — тихая отсылка к полосам. */
export function Meter({ value, over, label }: { value: number; over?: boolean; label: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={over ? "meter over" : "meter"}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <i style={{ width: `${over ? 100 : pct}%` }} />
    </div>
  );
}

/** Кольцо прогресса: уровень в профиле и прогресс дня. */
export function Ring({ value, size = 64, width = 6, children, label }: {
  value: number; size?: number; width?: number; children?: ReactNode; label: string;
}) {
  const r = (size - width) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="level-ring" style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={width} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${v * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .5s var(--ease)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        {children}
      </div>
    </div>
  );
}
