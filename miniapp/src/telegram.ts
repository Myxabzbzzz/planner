import { useEffect } from "react";

type WebApp = {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  disableVerticalSwipes?(): void;
  HapticFeedback?: { selectionChanged(): void; notificationOccurred?(t: "success" | "error" | "warning"): void };
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  close?(): void;
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};

export const tg: WebApp | undefined = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

export function initTelegram() {
  tg?.ready();
  tg?.expand();
  tg?.setHeaderColor?.("secondary_bg_color");
  tg?.setBackgroundColor?.("secondary_bg_color");
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
