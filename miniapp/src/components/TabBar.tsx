import type { ReactNode } from "react";
import { haptic } from "../telegram";

export type Tab = { key: string; label: string; icon: ReactNode; badge?: boolean };

export function TabBar({ tabs, active, onChange }: {
  tabs: Tab[]; active: string; onChange: (k: string) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={t.key === active ? "tab on" : "tab"}
          aria-current={t.key === active ? "page" : undefined}
          onClick={() => {
            if (t.key !== active) {
              haptic();
              onChange(t.key);
            }
          }}
        >
          {t.icon}
          <span>{t.label}</span>
          {t.badge && <span className="tab-badge" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}
