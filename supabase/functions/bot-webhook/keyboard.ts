export const MENU = {
  today: "📅 Сегодня",
  tasks: "☑️ Задачи",
  money: "💸 Деньги",
  habits: "🔁 Привычки",
  app: "📱 Приложение",
  settings: "⚙️ Настройки",
} as const;

export type MenuKey = keyof typeof MENU;

export const MENU_ROWS: string[][] = [
  [MENU.today, MENU.tasks],
  [MENU.money, MENU.habits],
  [MENU.app, MENU.settings],
];

export function menuKey(text?: string): MenuKey | null {
  const t = text?.trim();
  if (!t) return null;
  for (const [k, v] of Object.entries(MENU)) if (v === t) return k as MenuKey;
  return null;
}

export const TZ_OPTIONS: { key: string; label: string; tz: string }[] = [
  { key: "tashkent", label: "Ташкент", tz: "Asia/Tashkent" },
  { key: "moscow", label: "Москва", tz: "Europe/Moscow" },
  { key: "almaty", label: "Алматы", tz: "Asia/Almaty" },
  { key: "kyiv", label: "Киев", tz: "Europe/Kyiv" },
  { key: "dubai", label: "Дубай", tz: "Asia/Dubai" },
  { key: "berlin", label: "Берлин", tz: "Europe/Berlin" },
];
