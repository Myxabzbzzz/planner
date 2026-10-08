import type { Review, ReviewsResp } from "./types";

/** Ответ api_reviews: вопросы сгруппированы по записи inbox, у каждой кнопки свой RPC. */
export type ReviewsWire = {
  reviews: {
    inbox_id: string;
    created_at: string;
    questions: {
      idx: number;
      reason: string | null;
      title: string | null;
      source_text: string | null;
      options: { rpc: string; arg: string; label: string }[];
    }[];
  }[];
};

function question(reason: string | null, title: string | null): string {
  const t = title ? `«${title}»` : "запись";
  if (reason === "time") return `Во сколько ${t}?`;
  if (reason === "past") return `Время уже прошло. Когда ${t}?`;
  if (reason === "future") return `Дата ещё не наступила. Записать ${t} на сегодня?`;
  return "Куда отнести?";
}

/** Одна карточка на вопрос; «time»/«type» — у кнопки, потому что в одном вопросе бывают оба. */
export function flattenReviews(wire: ReviewsWire): ReviewsResp {
  const reviews: Review[] = [];
  for (const r of wire.reviews ?? []) {
    for (const q of r.questions ?? []) {
      reviews.push({
        inbox_id: r.inbox_id,
        index: q.idx,
        question: question(q.reason, q.title),
        source_text: q.source_text ?? "",
        created_at: r.created_at,
        options: (q.options ?? []).map((o) => ({
          key: o.arg, label: o.label, kind: o.rpc === "resolve_time" ? "time" : "type",
        })),
      });
    }
  }
  return { reviews };
}
