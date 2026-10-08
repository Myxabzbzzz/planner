export type HomeScreenStatus = "unsupported" | "unknown" | "added" | "missed";

/** Предлагать иконку на экране «Домой», только если её можно добавить и её там ещё нет. */
export const offerHomeScreen = (s: HomeScreenStatus) => s === "missed" || s === "unknown";
