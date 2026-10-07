import { haptic } from "../telegram";

export function Segmented<K extends string>({ items, value, onChange, label }: {
  items: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {items.map((i) => (
        <button
          key={i.key}
          type="button"
          role="tab"
          aria-selected={i.key === value}
          className={i.key === value ? "seg on" : "seg"}
          onClick={() => {
            if (i.key !== value) {
              haptic();
              onChange(i.key);
            }
          }}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
