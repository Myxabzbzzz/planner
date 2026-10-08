import { describe, expect, it } from "vitest";
import { flattenReviews } from "./reviews";

// Ровно та форма, которую отдаёт api_reviews (20261008000009_reviews.sql).
const WIRE = {
  reviews: [
    {
      inbox_id: "i1", source: "text", created_at: "2026-10-07T09:12", status: "needs_review", text: "такси 400 и встреча",
      questions: [
        { idx: 0, reason: "laya", title: "Такси", source_text: "такси 400", kind: "expense", item: {}, laya: null,
          options: [{ rpc: "resolve_review", arg: "expense", label: "Расход" },
                    { rpc: "resolve_review", arg: "drop", label: "Пропустить" }] },
        { idx: 2, reason: "past", title: "Встреча", source_text: "встреча 04:30", kind: "event", item: {}, laya: null,
          options: [{ rpc: "resolve_time", arg: "0430", label: "Завтра 04:30" },
                    { rpc: "resolve_review", arg: "event", label: "Оставить 04:30" }] },
      ],
    },
  ],
};

describe("flattenReviews", () => {
  it("turns each open question into its own card with per-option answer kind", () => {
    const out = flattenReviews(WIRE);
    expect(out.reviews).toHaveLength(2);
    expect(out.reviews[0]).toMatchObject({
      inbox_id: "i1", index: 0, source_text: "такси 400", created_at: "2026-10-07T09:12",
      options: [{ key: "expense", label: "Расход", kind: "type" }, { key: "drop", label: "Пропустить", kind: "type" }],
    });
    expect(out.reviews[1].index).toBe(2);
    expect(out.reviews[1].options.map((o) => o.kind)).toEqual(["time", "type"]);
    expect(out.reviews[1].question).toContain("уже прошло");
  });

  it("survives an empty or odd payload", () => {
    expect(flattenReviews({ reviews: [] }).reviews).toEqual([]);
    expect(flattenReviews({ reviews: [{ inbox_id: "x", created_at: "", questions: [] }] } as never).reviews).toEqual([]);
  });
});
