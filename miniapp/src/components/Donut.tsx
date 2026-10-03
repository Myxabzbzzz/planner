import type { ReactNode } from "react";
import type { Slice } from "../charts";

export function Donut({ slices, size = 140, children }: { slices: Slice[]; size?: number; children?: ReactNode }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--bg2)" strokeWidth="14" />
        {slices.map((s) => (
          <circle key={s.name} cx="60" cy="60" r={r} fill="none" stroke={s.color} strokeWidth="14"
            strokeDasharray={`${Math.max(0, s.share * c - 1.5)} ${c}`} strokeDashoffset={-s.offset * c}
            transform="rotate(-90 60 60)" />
        ))}
      </svg>
      <div className="donut-center">{children}</div>
    </div>
  );
}
