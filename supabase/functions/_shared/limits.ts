/**
 * Сколько человек может отправить за окно. Очередь на ноутбуке одна на всех, поэтому лимит
 * общий для чата, миниаппа и Shortcuts: действие «inbox» считается вместе, откуда бы ни пришло.
 * Пороги щедрые для человека и тесные для скрипта.
 */
export const LIMITS = {
  inbox: { limit: 40, window: "10 minutes" },
  audio: { limit: 15, window: "10 minutes" },
  write: { limit: 300, window: "10 minutes" },
} as const;

export type LimitAction = keyof typeof LIMITS;

/** Голосовое длиннее — распознавание займёт ноутбук на минуты и упрётся в таймаут «зависшей» записи. */
export const MAX_VOICE_SEC = 300;

export const TOO_MANY = "🐢 Слишком много записей подряд. Подожди пару минут и пришли ещё.";
export const TOO_LONG_VOICE = "🎙 Голосовое длиннее 5 минут — разбей его на части, так я разберу точнее.";
