import type { ReactNode } from "react";

/** Один набор: сетка 24, обводка 1.8, скруглённые концы. Никаких эмодзи в роли иконок. */
const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const svg = (d: ReactNode, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...P} aria-hidden="true">{d}</svg>
);

export const IconToday = () => svg(<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M8 3v4M16 3v4M3 10h18M8 15h4" /></>);
export const IconTasks = () => svg(<><path d="M4 7h10M4 12h10M4 17h6" /><path d="M18 6.5l2 2 3-3.5" /></>);
export const IconMoney = () => svg(<><path d="M4 19V9M10 19V5M16 19v-6M22 19H3" /></>);
export const IconHabits = () => svg(<><path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3" /><path d="M21 4v4.5h-4.5" /><path d="M9 12.5l2 2 4-4.5" /></>);
export const IconNotes = () => svg(<><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4v5h5M8 13h7M8 17h4" /></>);

export const IconMic = ({ size = 20 }: { size?: number }) => svg(<><rect x="9.5" y="3" width="5" height="10" rx="2.5" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>, size);
export const IconSend = ({ size = 20 }: { size?: number }) => svg(<path d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />, size);
export const IconStop = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
);
export const IconClose = ({ size = 18 }: { size?: number }) => svg(<path d="M6 6l12 12M18 6L6 18" />, size);
export const IconPlus = ({ size = 20 }: { size?: number }) => svg(<path d="M12 5v14M5 12h14" />, size);
export const IconChevron = ({ dir, size = 20 }: { dir: "left" | "right"; size?: number }) =>
  svg(<path d={dir === "left" ? "M14.5 5l-7 7 7 7" : "M9.5 5l7 7-7 7"} />, size);
export const IconTick = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...P} strokeWidth={3.4} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);
export const IconGear = ({ size = 20 }: { size?: number }) => svg(<><circle cx="12" cy="12" r="3" /><path d="M12 2.5v2.2M12 19.3v2.2M4.2 7l1.9 1.1M17.9 15.9l1.9 1.1M4.2 17l1.9-1.1M17.9 8.1l1.9-1.1" /></>, size);
export const IconSearch = ({ size = 18 }: { size?: number }) => svg(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></>, size);

/** Пустые состояния и награды. */
export const IconCalm = ({ size = 28 }: { size?: number }) => svg(<><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c1 1 2.2 1.5 3.5 1.5s2.5-.5 3.5-1.5M9 9.5h.01M15 9.5h.01" /></>, size);
export const IconFlame = ({ size = 20 }: { size?: number }) => svg(<path d="M12 3c3.5 4 5.5 6.3 5.5 9a5.5 5.5 0 0 1-11 0c0-1.3.5-2.5 1.5-3.8.3 1.6 1 2.3 2 2.3 1.3 0 2-1 2-2.8 0-1.4-.3-2.9-1-4.7z" />, size);
export const IconMedal = ({ size = 20 }: { size?: number }) => svg(<><circle cx="12" cy="14.5" r="5.5" /><path d="M9 9L7 3h10l-2 6M12 12.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2L9 14.6l2-.3z" /></>, size);
export const IconLock = ({ size = 20 }: { size?: number }) => svg(<><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" /></>, size);
