import type { ReactNode } from "react";
import { haptic } from "../telegram";

export type Tab = { key: string; label: string; icon: ReactNode };

export function TabBar({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (k: string) => void }) {
  return (
    <nav className="tabbar">
      {tabs.map((t) => (
        <button key={t.key} className={t.key === active ? "tab active" : "tab"}
          onClick={() => { if (t.key !== active) { haptic(); onChange(t.key); } }}>
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
