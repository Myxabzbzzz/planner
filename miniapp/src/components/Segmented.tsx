import { haptic } from "../telegram";

export function Segmented<K extends string>({ items, value, onChange }: {
  items: { key: K; label: string }[]; value: K; onChange: (k: K) => void;
}) {
  return (
    <div className="segmented">
      {items.map((i) => (
        <button key={i.key} className={i.key === value ? "seg active" : "seg"}
          onClick={() => { if (i.key !== value) { haptic(); onChange(i.key); } }}>
          {i.label}
        </button>
      ))}
    </div>
  );
}
