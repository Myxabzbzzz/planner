import { IconTick } from "./Icons";

export function Check({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      className={done ? "check on" : "check"}
      aria-label={label}
      aria-pressed={done}
      onClick={onToggle}
    >
      {done && <IconTick />}
    </button>
  );
}
