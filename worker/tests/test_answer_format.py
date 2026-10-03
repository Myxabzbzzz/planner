from datetime import date

import pytest

from planner_worker.answer_format import (UNKNOWN_TEXT, plural, render_agenda, render_compare, render_find_event,
                                          render_limit, render_no_category, render_open_tasks, render_sum,
                                          render_top)
from planner_worker.periods import compare_periods, resolve_period

TODAY = date(2026, 10, 1)
SEP = resolve_period("month:2026-09", TODAY)
OPS = ("операция", "операции", "операций")


@pytest.mark.parametrize("n,word", [(1, "операция"), (2, "операции"), (5, "операций"), (11, "операций"),
                                    (21, "операция"), (24, "операции"), (112, "операций")])
def test_plural(n, word):
    assert plural(n, OPS) == word


def test_sum_with_category(ctx):
    text = render_sum("spent", "такси/транспорт", SEP, {"total": 412000, "count": 14}, ctx)
    assert text == "💸 Такси/транспорт в сентябре: 412 000 сум (14 операций)"


def test_sum_without_category(ctx):
    text = render_sum("spent", None, resolve_period("this_month", TODAY), {"total": 1840000.5, "count": 52}, ctx)
    assert text == "💸 Потрачено в октябре: 1 840 000,50 сум (52 операции)"


def test_income(ctx):
    assert render_sum("income", None, SEP, {"total": 12000000, "count": 1}, ctx) == \
        "💰 Доход в сентябре: 12 000 000 сум (1 операция)"


def test_sum_empty(ctx):
    assert render_sum("spent", "такси/транспорт", SEP, {"total": 0, "count": 0}, ctx) == \
        "💸 Трат на «такси/транспорт» в сентябре нет"
    assert render_sum("spent", None, SEP, {"total": 0, "count": 0}, ctx) == "💸 Трат в сентябре нет"
    assert render_sum("income", "зарплата", SEP, {"total": 0, "count": 0}, ctx) == \
        "💰 Доходов «зарплата» в сентябре нет"


def test_top(ctx):
    data = {"total": 1000, "items": [{"name": "еда", "amount": 500}, {"name": "кафе", "amount": 300}], "other": 200}
    assert render_top(SEP, data, ctx) == (
        "📊 Траты в сентябре — 1 000 сум:\nЕда — 500 (50%)\nКафе — 300 (30%)\nОстальное — 200 (20%)")


def test_top_empty(ctx):
    assert render_top(SEP, {"total": 0, "items": [], "other": 0}, ctx) == "📊 Трат в сентябре нет"


def test_limit_left(ctx):
    data = {"month": "2026-10", "limit": 5000000, "spent": 1840000, "days_left": 27}
    assert render_limit(None, data, ctx) == \
        "🎯 До лимита: 3 160 000 сум из 5 000 000 · ещё 27 дней → ~117 037 в день"


def test_limit_last_day(ctx):
    data = {"month": "2026-10", "limit": 100, "spent": 40, "days_left": 1}
    assert render_limit(None, data, ctx) == "🎯 До лимита: 60 сум из 100 · ещё 1 день → ~60 в день"


def test_limit_over(ctx):
    data = {"month": "2026-10", "limit": 5000000, "spent": 5240000, "days_left": 10}
    assert render_limit(None, data, ctx) == "🎯 Лимит превышен на 240 000 сум (5 240 000 из 5 000 000 сум)"


def test_limit_not_set(ctx):
    data = {"month": "2026-10", "limit": None, "spent": 1840000, "days_left": 27}
    assert render_limit(None, data, ctx) == "🎯 Лимит не задан. Потрачено в октябре: 1 840 000 сум"
    assert render_limit("кафе", data, ctx) == \
        "🎯 Лимит на «кафе» не задан. Потрачено на «кафе» в октябре: 1 840 000 сум"


def test_compare(ctx):
    cur, prev = compare_periods(None, None, date(2026, 10, 4))
    text = render_compare(None, cur, {"total": 1840000}, prev, {"total": 1520000}, ctx)
    assert text == "📈 Траты: октябрь (1–4) 1 840 000 сум vs сентябрь (1–4) 1 520 000 сум · +21%"


def test_compare_down_and_zero(ctx):
    cur, prev = compare_periods("this_week", None, TODAY)
    assert render_compare("кафе", cur, {"total": 50}, prev, {"total": 100}, ctx) == \
        "📈 Траты на «кафе»: эта неделя (пн–чт) 50 сум vs прошлая неделя (пн–чт) 100 сум · −50%"
    assert render_compare(None, cur, {"total": 50}, prev, {"total": 0}, ctx) == \
        "📈 Траты: эта неделя (пн–чт) 50 сум vs прошлая неделя (пн–чт) 0 сум"


def test_agenda_day():
    data = {"events": [{"day": "2026-10-02", "time": "10:00", "title": "Стоматолог", "with_whom": None, "done": False},
                       {"day": "2026-10-02", "time": "15:00", "title": "Встреча", "with_whom": "Ахмед", "done": True}],
            "tasks": [{"title": "Оплатить интернет", "done": False}, {"title": "Позвонить", "done": True}]}
    assert render_agenda(resolve_period("tomorrow", TODAY), data) == (
        "📅 Завтра, 2 октября:\n10:00 Стоматолог\n15:00 Встреча (Ахмед) ✓\n☑️ Оплатить интернет\n✅ Позвонить")


def test_agenda_week_shows_days():
    data = {"events": [{"day": "2026-10-05", "time": "15:00", "title": "Встреча с Ахмедом", "with_whom": "Ахмед",
                        "done": False}], "tasks": []}
    assert render_agenda(resolve_period("next_week", TODAY), data) == \
        "📅 На следующей неделе:\nпн 05.10 15:00 Встреча с Ахмедом"


def test_agenda_empty():
    assert render_agenda(resolve_period("today", TODAY), {"events": [], "tasks": []}) == \
        "📅 Сегодня, 1 октября: ничего не запланировано 🎉"


def test_open_tasks():
    data = {"overdue": 1, "today": 1, "later": 0, "no_due": 1,
            "items": [{"title": "Отчёт", "bucket": "overdue", "due": "2026-09-30"},
                      {"title": "Купить хлеб", "bucket": "today", "due": "2026-10-01"},
                      {"title": "Почитать", "bucket": "no_due", "due": None}]}
    assert render_open_tasks(data) == (
        "☑️ Не сделано: 3 (просрочено 1 · сегодня 1 · без срока 1)\n"
        "⚠️ Отчёт — до 30.09\n• Купить хлеб — сегодня\n• Почитать")


def test_open_tasks_more_and_empty():
    data = {"overdue": 0, "today": 0, "later": 12, "no_due": 0,
            "items": [{"title": f"T{i}", "bucket": "later", "due": "2026-10-10"} for i in range(10)]}
    assert render_open_tasks(data).endswith("• T9 — до 10.10\n…и ещё 2")
    assert render_open_tasks({"overdue": 0, "today": 0, "later": 0, "no_due": 0, "items": []}) == "☑️ Всё сделано 🎉"


def test_find_event_future_and_past():
    e = {"day": "2026-10-05", "time": "15:00", "title": "Встреча с Ахмедом", "with_whom": "Ахмед"}
    assert render_find_event("Ахмед", {"future": [e], "past": []}) == "🔎 Встреча с Ахмедом — пн, 5 октября, 15:00"
    assert render_find_event("Ахмед", {"future": [], "past": [e]}) == \
        "🔎 Впереди таких встреч нет. Последние:\nВстреча с Ахмедом — пн, 5 октября, 15:00"
    assert render_find_event("Ахмед", {"future": [], "past": []}) == \
        "🔎 Не нашёл встреч с «Ахмед» за последний и ближайший месяц"


def test_no_category_and_unknown():
    assert render_no_category("бензин", {"еда": "1", "кафе": "2"}) == "🤔 Нет категории «бензин». Есть: еда, кафе"
    assert UNKNOWN_TEXT.startswith("🤔 Не понял вопрос.")
