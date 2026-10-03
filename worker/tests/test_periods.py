from datetime import date

import pytest

from planner_worker.periods import Period, compare_periods, month_period, previous_period, resolve_period

TODAY = date(2026, 10, 1)  # четверг


def span(p: Period):
    return p.start, p.end


@pytest.mark.parametrize("code,start,end,phrase,short", [
    ("today", date(2026, 10, 1), date(2026, 10, 2), "сегодня", "сегодня"),
    ("yesterday", date(2026, 9, 30), date(2026, 10, 1), "вчера", "вчера"),
    ("tomorrow", date(2026, 10, 2), date(2026, 10, 3), "завтра", "завтра"),
    ("this_week", date(2026, 9, 28), date(2026, 10, 5), "на этой неделе", "эта неделя"),
    ("last_week", date(2026, 9, 21), date(2026, 9, 28), "на прошлой неделе", "прошлая неделя"),
    ("next_week", date(2026, 10, 5), date(2026, 10, 12), "на следующей неделе", "следующая неделя"),
    ("this_month", date(2026, 10, 1), date(2026, 11, 1), "в октябре", "октябрь"),
    ("last_month", date(2026, 9, 1), date(2026, 10, 1), "в сентябре", "сентябрь"),
    ("next_7_days", date(2026, 10, 1), date(2026, 10, 8), "в ближайшие 7 дней", "ближайшие 7 дней"),
    ("all_time", None, None, "за всё время", "всё время"),
    ("month:2026-09", date(2026, 9, 1), date(2026, 10, 1), "в сентябре", "сентябрь"),
    ("month:2025-05", date(2025, 5, 1), date(2025, 6, 1), "в мае 2025", "май 2025"),
])
def test_resolve(code, start, end, phrase, short):
    p = resolve_period(code, TODAY)
    assert (p.start, p.end, p.phrase, p.short) == (start, end, phrase, short)


def test_future_month_goes_to_previous_year():
    p = resolve_period("month:2026-12", TODAY)
    assert span(p) == (date(2025, 12, 1), date(2026, 1, 1))
    assert p.phrase == "в декабре 2025"


def test_current_month_code_is_not_shifted():
    assert span(resolve_period("month:2026-10", TODAY)) == (date(2026, 10, 1), date(2026, 11, 1))


def test_last_month_in_january():
    p = resolve_period("last_month", date(2027, 1, 15))
    assert span(p) == (date(2026, 12, 1), date(2027, 1, 1))
    assert p.phrase == "в декабре 2026"


def test_week_on_sunday():
    assert span(resolve_period("this_week", date(2026, 10, 4))) == (date(2026, 9, 28), date(2026, 10, 5))


def test_unknown_code():
    with pytest.raises(ValueError):
        resolve_period("someday", TODAY)


def test_month_period_december():
    assert span(month_period(2026, 12, TODAY)) == (date(2026, 12, 1), date(2027, 1, 1))


def test_previous_of_month_is_month():
    p = previous_period(resolve_period("month:2026-03", TODAY), TODAY)
    assert span(p) == (date(2026, 2, 1), date(2026, 3, 1))
    assert p.short == "февраль"


def test_previous_of_week_and_day():
    assert previous_period(resolve_period("this_week", TODAY), TODAY).short == "прошлая неделя"
    assert previous_period(resolve_period("today", TODAY), TODAY).short == "вчера"
    p = previous_period(resolve_period("yesterday", TODAY), TODAY)
    assert span(p) == (date(2026, 9, 29), date(2026, 9, 30))
    assert p.short == "29 сентября"


def test_previous_of_next_7_days_is_span():
    p = previous_period(resolve_period("next_7_days", TODAY), TODAY)
    assert span(p) == (date(2026, 9, 24), date(2026, 10, 1))
    assert p.short == "24.09–30.09"


def test_previous_of_all_time_is_none():
    assert previous_period(resolve_period("all_time", TODAY), TODAY) is None


def test_compare_default_month_to_date():
    cur, prev = compare_periods(None, None, date(2026, 10, 4))
    assert span(cur) == (date(2026, 10, 1), date(2026, 10, 5))
    assert span(prev) == (date(2026, 9, 1), date(2026, 9, 5))
    assert (cur.short, prev.short) == ("октябрь (1–4)", "сентябрь (1–4)")


def test_compare_default_on_31st_clips_previous_month():
    cur, prev = compare_periods(None, None, date(2026, 10, 31))
    assert span(prev) == (date(2026, 9, 1), date(2026, 10, 1))
    assert prev.short == "сентябрь (1–30)"


def test_compare_default_in_january_shows_year():
    cur, prev = compare_periods(None, None, date(2027, 1, 10))
    assert span(prev) == (date(2026, 12, 1), date(2026, 12, 11))
    assert prev.short == "декабрь 2026 (1–10)"


def test_compare_single_period_uses_previous():
    cur, prev = compare_periods("this_week", None, TODAY)
    assert (cur.short, prev.short) == ("эта неделя", "прошлая неделя")


def test_compare_only_second_period_is_treated_as_first():
    cur, prev = compare_periods(None, "month:2026-09", TODAY)
    assert (cur.short, prev.short) == ("сентябрь", "август")


def test_compare_two_periods():
    cur, prev = compare_periods("month:2026-09", "month:2026-08", TODAY)
    assert (cur.short, prev.short) == ("сентябрь", "август")


def test_compare_all_time_is_none():
    assert compare_periods("all_time", None, TODAY) is None
