/** Повторяющиеся дела и встречи (Pro). Правило выбирается при создании, остановить можно в карточке. */
export const FREQS = ["daily", "weekdays", "weekly", "monthly"] as const;
export type Freq = typeof FREQS[number];
export type Repeat = { id: string; freq: Freq };

const LABELS: Record<Freq, string> = {
  daily: "каждый день",
  weekdays: "по будням",
  weekly: "каждую неделю",
  monthly: "каждый месяц",
};

export const repeatLabel = (f: Freq) => LABELS[f];

/** Чипы выбора: null — без повтора. */
export const REPEAT_CHOICES: { key: Freq | null; label: string }[] = [
  { key: null, label: "Нет" },
  ...FREQS.map((f) => ({ key: f, label: LABELS[f][0].toUpperCase() + LABELS[f].slice(1) })),
];
