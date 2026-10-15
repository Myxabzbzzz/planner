import { IconChevron, IconLock } from "./Icons";

/** Строка «это есть в Pro»: замок, что даёт, стрелка — открывает шторку подписки. */
export function ProTeaser({ title, hint, onPro }: { title: string; hint?: string; onPro: () => void }) {
  return (
    <button type="button" className="row pro-teaser" onClick={onPro}>
      <span className="pro-teaser-ico"><IconLock size={18} /></span>
      <span className="grow">
        <span className="row-title" style={{ display: "block", minHeight: 0 }}>{title}</span>
        {hint && <span className="row-sub">{hint}</span>}
      </span>
      <span className="pro-badge">Pro</span>
      <IconChevron dir="right" size={18} />
    </button>
  );
}
