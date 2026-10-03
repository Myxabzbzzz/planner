import { useCallback, useRef, useState } from "react";
import { optimisticToggle } from "./optimistic";
import { hapticResult } from "./telegram";

// Optimistic overrides by key; taps on a key are ignored while its request is in flight.
export function useToggles() {
  const [over, setOver] = useState<Record<string, boolean>>({});
  const pending = useRef(new Set<string>());
  const toggle = useCallback(async (key: string, cur: boolean, send: (v: boolean) => Promise<unknown>) => {
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      await optimisticToggle(cur, (v) => setOver((m) => ({ ...m, [key]: v })), send, hapticResult);
    } finally {
      pending.current.delete(key);
    }
  }, []);
  const reset = useCallback(() => setOver({}), []);
  return { over, toggle, reset };
}
