import { useEffect, useState } from "react";
import type { HomeScreenStatus } from "./homeScreen";

type Inset = { top: number; bottom: number; left: number; right: number };

type WebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  themeParams?: Record<string, string>;
  isFullscreen?: boolean;
  safeAreaInset?: Inset;
  contentSafeAreaInset?: Inset;
  viewportHeight?: number;
  viewportStableHeight?: number;
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  isVersionAtLeast?(v: string): boolean;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  onEvent?(type: string, cb: () => void): void;
  offEvent?(type: string, cb: () => void): void;
  HapticFeedback?: {
    selectionChanged?(): void;
    impactOccurred?(s: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred?(t: "success" | "error" | "warning"): void;
  };
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  openInvoice?(url: string, cb: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  openTelegramLink?(url: string): void;
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(cb: (status: HomeScreenStatus) => void): void;
  close?(): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};

export const tg: WebApp | undefined = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

const THEMES = { dark: "#0B0D10", light: "#FAF9F7" } as const;

/** Старые клиенты принимают в этих методах только ключи темы — hex там бросает. */
function paint(set: ((c: string) => void) | undefined, color: string) {
  if (!set) return;
  try {
    set.call(tg, tg?.isVersionAtLeast?.("6.9") ? color : "bg_color");
  } catch {
    // старый клиент — оставляем цвет темы
  }
}

function applyTheme(scheme: "light" | "dark") {
  const root = document.documentElement;
  root.dataset.theme = scheme;
  const bg = THEMES[scheme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  paint(tg?.setHeaderColor, bg);
  paint(tg?.setBackgroundColor, bg);
  paint(tg?.setBottomBarColor, bg);
}

const px = (n: number | undefined) => `${Math.max(0, Math.round(n ?? 0))}px`;

/**
 * Безопасные зоны. `env(safe-area-inset-*)` не знает про шапку Telegram:
 * в fullscreen она просто накрывает контент. Инсеты из Bot API 8.0 это учитывают,
 * а на старых клиентах остаётся значение из CSS.
 */
function applyInsets() {
  if (!tg) return;
  const root = document.documentElement.style;
  const top = (tg.contentSafeAreaInset?.top ?? 0) + (tg.safeAreaInset?.top ?? 0);
  const bottom = (tg.contentSafeAreaInset?.bottom ?? 0) + (tg.safeAreaInset?.bottom ?? 0);
  if (tg.safeAreaInset || tg.contentSafeAreaInset) {
    root.setProperty("--sat", px(top));
    root.setProperty("--sab", px(bottom));
  }
}

/**
 * Клавиатура. Док приклеен к низу, и на iOS софт-клавиатура его перекрывала:
 * visualViewport даёт реальную высоту видимой области.
 */
function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb", px(hidden));
  };
  vv.addEventListener("resize", sync);
  vv.addEventListener("scroll", sync);
  sync();
}

/**
 * `?theme=dark` / `?theme=light` перебивает тему Telegram.
 * Вне Telegram SDK всегда сообщает «light», поэтому без этого посмотреть
 * тёмную тему в обычном браузере было нечем.
 */
function forcedTheme(): "light" | "dark" | null {
  const v = new URLSearchParams(location.search).get("theme");
  return v === "dark" || v === "light" ? v : null;
}

export function initTelegram() {
  tg?.ready();
  tg?.expand();
  tg?.disableVerticalSwipes?.();
  applyTheme(forcedTheme() ?? tg?.colorScheme ?? "dark");
  applyInsets();
  trackKeyboard();
  tg?.onEvent?.("themeChanged", () => applyTheme(forcedTheme() ?? tg?.colorScheme ?? "dark"));
  tg?.onEvent?.("safeAreaChanged", applyInsets);
  tg?.onEvent?.("contentSafeAreaChanged", applyInsets);
  tg?.onEvent?.("fullscreenChanged", applyInsets);
}

export const haptic = () => tg?.HapticFeedback?.selectionChanged?.();
export const tap = () => tg?.HapticFeedback?.impactOccurred?.("light");
export const thud = () => tg?.HapticFeedback?.impactOccurred?.("medium");
export const hapticResult = (ok: boolean) => tg?.HapticFeedback?.notificationOccurred?.(ok ? "success" : "error");

/**
 * Системная кнопка «Назад» и свайп назад на Android закрывают верхний слой,
 * а не весь миниапп. Слои складываются в стек: закрывается последний открытый.
 */
const backStack: Array<() => void> = [];
let backBound = false;

function runTopBack() {
  backStack[backStack.length - 1]?.();
}

function syncBackButton() {
  const bb = tg?.BackButton;
  if (!bb) return;
  if (backStack.length > 0) {
    if (!backBound) {
      bb.onClick(runTopBack);
      backBound = true;
    }
    bb.show();
  } else {
    if (backBound) {
      bb.offClick(runTopBack);
      backBound = false;
    }
    bb.hide();
  }
}

export function useBackButton(onBack: (() => void) | null) {
  useEffect(() => {
    if (!onBack) return;
    backStack.push(onBack);
    syncBackButton();
    return () => {
      const i = backStack.lastIndexOf(onBack);
      if (i >= 0) backStack.splice(i, 1);
      syncBackButton();
    };
  }, [onBack]);
}

/** Пока в шторке есть несохранённые правки, Telegram спросит перед закрытием. */
export function useCloseGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    tg?.enableClosingConfirmation?.();
    return () => tg?.disableClosingConfirmation?.();
  }, [dirty]);
}

export function confirmDialog(message: string): Promise<boolean> {
  if (tg?.showConfirm) return new Promise((resolve) => tg!.showConfirm!(message, resolve));
  return Promise.resolve(window.confirm(message));
}

/** Оплата звёздами внутри Telegram. Вне Telegram (dev) — просто открываем ссылку. */
export function openInvoice(url: string): Promise<"paid" | "cancelled" | "failed" | "pending"> {
  if (tg?.openInvoice) return new Promise((resolve) => tg!.openInvoice!(url, resolve));
  window.open(url, "_blank");
  return Promise.resolve("pending");
}

/**
 * Иконка Mini App на экране «Домой» (Bot API 8.0+, мобильные). Статус спрашиваем у Telegram;
 * после добавления он присылает homeScreenAdded — тогда кнопку прячем.
 */
export function useHomeScreen(): { status: HomeScreenStatus; add: () => void } {
  const [status, setStatus] = useState<HomeScreenStatus>("unsupported");
  useEffect(() => {
    if (!tg?.checkHomeScreenStatus || !tg.isVersionAtLeast?.("8.0")) return;
    tg.checkHomeScreenStatus((s) => setStatus(s));
    const added = () => setStatus("added");
    tg.onEvent?.("homeScreenAdded", added);
    return () => tg?.offEvent?.("homeScreenAdded", added);
  }, []);
  return { status, add: () => tg?.addToHomeScreen?.() };
}
