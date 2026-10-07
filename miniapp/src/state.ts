import { ApiError } from "./api";

export type Screen = "outside" | "relaunch" | "noaccess" | "server" | "network" | "ok";

/**
 * Любая серверная ошибка раньше показывалась как «Нет связи»: человек шёл проверять
 * свой интернет, хотя 500 прилетел с бэкенда. Теперь это разные экраны.
 */
export function screenForState(s: { initData: string; error: unknown }): Screen {
  if (!s.initData) return "outside";
  if (s.error instanceof ApiError && s.error.status === 401) return "relaunch";
  if (s.error instanceof ApiError && s.error.status === 403) return "noaccess";
  if (s.error instanceof ApiError && s.error.status >= 500) return "server";
  if (s.error) return "network";
  return "ok";
}
