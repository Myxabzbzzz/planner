export type FxSnapshot = { date: string; rates: Record<string, number> };

// deno-lint-ignore no-explicit-any
export function parseErApi(json: any): FxSnapshot {
  if (json?.result !== "success" || json.base_code !== "USD" || typeof json.rates !== "object") {
    throw new Error(`bad fx payload: ${JSON.stringify(json).slice(0, 200)}`);
  }
  const date = new Date(json.time_last_update_unix * 1000).toISOString().slice(0, 10);
  return { date, rates: json.rates };
}
