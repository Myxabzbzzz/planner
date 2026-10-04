import { useCallback, useEffect, useRef, useState } from "react";

/** refresh — счётчик тихих перезагрузок: старые данные остаются на экране (открытая шторка не пропадает). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError(null);
    fn().then((d) => alive && setData(d)).catch((e) => alive && setError(e)).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const latest = useRef(fn);
  latest.current = fn;
  const seen = useRef(refresh);
  useEffect(() => {
    if (refresh === seen.current) return;  // только новые обновления, не при монтировании
    seen.current = refresh;
    let alive = true;
    latest.current().then((d) => alive && setData(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [refresh]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
