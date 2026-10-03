from datetime import date

from pydantic import ValidationError

from .answer_format import (UNKNOWN_TEXT, render_agenda, render_compare, render_find_event, render_limit,
                            render_no_category, render_open_tasks, render_sum, render_top)
from .periods import Period, compare_periods, resolve_period
from .prompts import QUESTION_SCHEMA, build_question_messages
from .schemas import Question, UserContext


def _drop_unsaid_today(q: Question, text: str) -> Question:
    """Qwen ставит today на «трачу» без периода; «сегодня» должно прозвучать."""
    if "сегодня" in text.lower():
        return q
    return q.model_copy(update={f: None for f in ("period", "period2") if getattr(q, f) == "today"})


class QuestionParser:
    def __init__(self, llm):
        self.llm = llm

    def parse(self, text: str, ctx: UserContext) -> Question:
        messages = build_question_messages(text, ctx)
        for _ in range(2):
            raw = self.llm.chat_json(messages, QUESTION_SCHEMA)
            try:
                return _drop_unsaid_today(Question.model_validate_json(raw), text)
            except ValidationError as e:
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": f"Ответ не прошёл проверку схемы: {e.errors(include_url=False)}. Верни исправленный JSON."},
                ]
        return Question(intent="unknown")


MONEY_WITH_CATEGORY = ("spent", "income", "compare", "limit_left")


def _norm(s: str) -> str:
    return s.strip().lower().replace("ё", "е")


def match_category(name: str, cats: dict[str, str]) -> tuple[str, str] | None:
    """«такси» находит «такси/транспорт»: сравнение целиком или с частью составного имени."""
    n = _norm(name)
    for key, cid in cats.items():
        k = _norm(key)
        if n == k or n in (part.strip() for part in k.split("/")):
            return key, cid
    return None


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


class Answerer:
    def __init__(self, parser: QuestionParser, store):
        self.parser, self.store = parser, store

    def answer(self, text: str, ctx: UserContext) -> tuple[str, dict] | None:
        """None — не вопрос к данным: текст разбирается как обычная запись."""
        q = self.parser.parse(text, ctx)
        if q.intent == "unknown":
            return None
        return self._answer(q, ctx), q.model_dump()

    def _sum(self, ctx: UserContext, kind: str, p: Period, category_id: str | None) -> dict:
        return self.store.ask("ask_sum", p_user=ctx.user_id, p_type=kind, p_from=_iso(p.start), p_to=_iso(p.end),
                              p_category=category_id)

    def _answer(self, q: Question, ctx: UserContext) -> str:
        today = ctx.now.date()
        cat_name = cat_id = None
        if q.category and q.intent in MONEY_WITH_CATEGORY:
            cats = ctx.income_categories if q.intent == "income" else ctx.expense_categories
            found = match_category(q.category, cats)
            if found is None:
                return render_no_category(q.category, cats)
            cat_name, cat_id = found

        if q.intent in ("spent", "income"):
            p = resolve_period(q.period or "this_month", today)
            data = self._sum(ctx, "expense" if q.intent == "spent" else "income", p, cat_id)
            return render_sum(q.intent, cat_name, p, data, ctx)
        if q.intent == "top_categories":
            p = resolve_period(q.period or "this_month", today)
            data = self.store.ask("ask_top_categories", p_user=ctx.user_id, p_from=_iso(p.start), p_to=_iso(p.end))
            return render_top(p, data, ctx)
        if q.intent == "limit_left":
            data = self.store.ask("ask_limit_left", p_user=ctx.user_id, p_category=cat_id)
            return render_limit(cat_name, data, ctx)
        if q.intent == "compare":
            pair = compare_periods(q.period, q.period2, today)
            if pair is None:
                return UNKNOWN_TEXT
            p1, p2 = pair
            return render_compare(cat_name, p1, self._sum(ctx, "expense", p1, cat_id),
                                  p2, self._sum(ctx, "expense", p2, cat_id), ctx)
        if q.intent == "agenda":
            p = resolve_period(q.period or "today", today, future_ok=True)  # планы смотрят вперёд
            data = self.store.ask("ask_agenda", p_user=ctx.user_id, p_from=_iso(p.start), p_to=_iso(p.end))
            return render_agenda(p, data)
        if q.intent == "open_tasks":
            return render_open_tasks(self.store.ask("ask_open_tasks", p_user=ctx.user_id))
        if q.intent == "find_event":
            query = q.query.strip()
            return render_find_event(query, self.store.ask("ask_find_event", p_user=ctx.user_id, p_query=query))
        return UNKNOWN_TEXT
