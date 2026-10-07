import { useEffect } from "react";

type WebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  isVersionAtLeast?(v: string): boolean;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { selectionChanged(): void; notificationOccurred?(t: "success" | "error" | "warning"): void };
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  close?(): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};

export const tg: WebApp | undefined = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

/** BEAR PLANNER chrome colour — matches --bg in styles.css, independent of the user's Telegram theme. */
export const BRAND_BG = "#120E0B";

// Older clients only accept theme keys (hex arrived in Bot API 6.9) and the SDK throws on a hex there.
function paint(set: ((c: string) => void) | undefined, color: string, fallback?: string) {
  if (!set) return;
  try {
    set.call(tg, tg?.isVersionAtLeast?.("6.9") ? color : fallback ?? color);
  } catch {
    // старый клиент — оставляем цвет темы
  }
}

export function initTelegram() {
  tg?.ready();
  tg?.expand();
  paint(tg?.setHeaderColor, BRAND_BG, "bg_color");
  paint(tg?.setBackgroundColor, BRAND_BG, "bg_color");
  paint(tg?.setBottomBarColor, BRAND_BG, "bg_color");
  tg?.disableVerticalSwipes?.();
}

export const haptic = () => tg?.HapticFeedback?.selectionChanged();

export const hapticResult = (ok: boolean) => tg?.HapticFeedback?.notificationOccurred?.(ok ? "success" : "error");

export function useBackButton(onBack: (() => void) | null) {
  useEffect(() => {
    const bb = tg?.BackButton;
    if (!bb || !onBack) return;
    bb.show();
    bb.onClick(onBack);
    return () => {
      bb.offClick(onBack);
      bb.hide();
    };
  }, [onBack]);
}

export function confirmDialog(message: string): Promise<boolean> {
  if (tg?.showConfirm) return new Promise((resolve) => tg!.showConfirm!(message, resolve));
  return Promise.resolve(window.confirm(message));
}
