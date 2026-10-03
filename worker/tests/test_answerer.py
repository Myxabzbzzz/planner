from planner_worker.answer import Answerer, match_category
from planner_worker.answer_format import UNKNOWN_TEXT
from planner_worker.schemas import Question

SUM = {"total": 50000, "count": 2}


class FakeParser:
    def __init__(self, question):
        self.question = question

    def parse(self, text, ctx):
        return self.question


class FakeStore:
    def __init__(self, replies=None):
        self.calls = []
        self.replies = replies or {}

    def ask(self, fn, **params):
        self.calls.append((fn, params))
        return self.replies.get(fn, SUM)


def run(ctx, store=None, **q):
    store = store or FakeStore()
    text, dump = Answerer(FakeParser(Question(**q)), store).answer("x", ctx)
    return text, dump, store.calls


def test_category_matches_part_of_compound_name(ctx):
    assert match_category("такси", ctx.expense_categories) == ("такси/транспорт", "c-taxi")
    assert match_category(" ТРАНСПОРТ ", ctx.expense_categories) == ("такси/транспорт", "c-taxi")
    assert match_category("Еда", ctx.expense_categories) == ("еда", "c-food")
    assert match_category("бензин", ctx.expense_categories) is None


def test_category_yo_is_normalized():
    assert match_category("ещё", {"еще": "c1"}) == ("еще", "c1")


def test_spent_with_category(ctx):
    text, dump, calls = run(ctx, intent="spent", category="такси", period="month:2026-09")
    assert calls == [("ask_sum", {"p_user": "u1", "p_type": "expense", "p_from": "2026-09-01",
                                  "p_to": "2026-10-01", "p_category": "c-taxi"})]
    assert text.startswith("💸 Такси/транспорт в сентябре: 50 000 сум")
    assert dump["intent"] == "spent"


def test_spent_default_period_is_this_month(ctx):
    _, _, calls = run(ctx, intent="spent")
    assert calls[0][1]["p_from"] == "2026-10-01" and calls[0][1]["p_to"] == "2026-11-01"
    assert calls[0][1]["p_category"] is None


def test_income_uses_income_categories(ctx):
    _, _, calls = run(ctx, intent="income", category="зарплата")
    assert calls[0][1]["p_type"] == "income" and calls[0][1]["p_category"] == "c-salary"


def test_unknown_category_skips_db(ctx):
    text, _, calls = run(ctx, intent="spent", category="бензин")
    assert calls == []
    assert text.startswith("🤔 Нет категории «бензин»")


def test_category_ignored_for_agenda(ctx):
    store = FakeStore({"ask_agenda": {"events": [], "tasks": []}})
    text, _, calls = run(ctx, store, intent="agenda", category="бензин")
    assert calls == [("ask_agenda", {"p_user": "u1", "p_from": "2026-10-01", "p_to": "2026-10-02"})]
    assert "ничего не запланировано" in text


def test_compare_default_calls_sum_twice(ctx):
    store = FakeStore()
    text, _, calls = run(ctx, store, intent="compare")
    assert [c[1]["p_from"] for c in calls] == ["2026-10-01", "2026-09-01"]
    assert [c[1]["p_to"] for c in calls] == ["2026-10-02", "2026-09-02"]
    assert all(c[0] == "ask_sum" and c[1]["p_type"] == "expense" for c in calls)
    assert text.startswith("📈 Траты: октябрь (1–1)")


def test_compare_all_time_is_unknown(ctx):
    text, _, calls = run(ctx, intent="compare", period="all_time")
    assert (text, calls) == (UNKNOWN_TEXT, [])


def test_top_and_all_time_dates_are_none(ctx):
    store = FakeStore({"ask_top_categories": {"total": 0, "items": [], "other": 0}})
    _, _, calls = run(ctx, store, intent="top_categories", period="all_time")
    assert calls == [("ask_top_categories", {"p_user": "u1", "p_from": None, "p_to": None})]


def test_limit_left(ctx):
    store = FakeStore({"ask_limit_left": {"month": "2026-10", "limit": None, "spent": 0, "days_left": 31}})
    text, _, calls = run(ctx, store, intent="limit_left", category="кафе")
    assert calls == [("ask_limit_left", {"p_user": "u1", "p_category": "c-cafe"})]
    assert text.startswith("🎯 Лимит на «кафе» не задан")


def test_open_tasks(ctx):
    store = FakeStore({"ask_open_tasks": {"overdue": 0, "today": 0, "later": 0, "no_due": 0, "items": []}})
    text, _, calls = run(ctx, store, intent="open_tasks")
    assert calls == [("ask_open_tasks", {"p_user": "u1"})]
    assert text == "☑️ Всё сделано 🎉"


def test_find_event_strips_query(ctx):
    store = FakeStore({"ask_find_event": {"future": [], "past": []}})
    text, _, calls = run(ctx, store, intent="find_event", query=" Ахмед ")
    assert calls == [("ask_find_event", {"p_user": "u1", "p_query": "Ахмед"})]
    assert "«Ахмед»" in text


def test_unknown(ctx):
    text, dump, calls = run(ctx, intent="unknown")
    assert (text, calls, dump["intent"]) == (UNKNOWN_TEXT, [], "unknown")
