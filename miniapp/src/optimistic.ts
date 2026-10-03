export async function optimisticToggle(
  current: boolean,
  apply: (v: boolean) => void,
  send: (v: boolean) => Promise<unknown>,
  fx: (ok: boolean) => void,
): Promise<boolean> {
  const next = !current;
  apply(next);
  try {
    await send(next);
    fx(true);
    return true;
  } catch {
    apply(current);
    fx(false);
    return false;
  }
}
