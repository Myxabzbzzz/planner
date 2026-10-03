import { ApiError } from "./api";

export type Screen = "outside" | "relaunch" | "noaccess" | "network" | "ok";

export function screenForState(s: { initData: string; error: unknown }): Screen {
  if (!s.initData) return "outside";
  if (s.error instanceof ApiError && s.error.status === 401) return "relaunch";
  if (s.error instanceof ApiError && s.error.status === 403) return "noaccess";
  if (s.error) return "network";
  return "ok";
}
