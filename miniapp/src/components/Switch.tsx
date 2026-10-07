export function Switch({ on, label, hint, onToggle, disabled }: {
  on: boolean; label: string; hint?: string; onToggle: () => void; disabled?: boolean;
}) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={on} onClick={onToggle} disabled={disabled}>
      <span className="switch-label">
        {label}
        {hint && <span className="row-sub">{hint}</span>}
      </span>
      <span className={on ? "knob on" : "knob"} aria-hidden="true"><i /></span>
    </button>
  );
}
