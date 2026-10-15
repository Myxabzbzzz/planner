from datetime import date

import pytest

from planner_worker.recurrence import detect

THU = date(2026, 10, 15)  # четверг
SAT = date(2026, 10, 17)


@pytest.mark.parametrize("text,expected,freq", [
    ("каждый понедельник созвон с командой в 10", "в понедельник созвон с командой в 10", "weekly"),
    ("Каждую среду бассейн в 19:00", "в среду бассейн в 19:00", "weekly"),
    ("каждое воскресенье звонить маме", "в воскресенье звонить маме", "weekly"),
    ("по пятницам выносить мусор", "в пятницу выносить мусор", "weekly"),
    ("по средам английский в 18", "в среду английский в 18", "weekly"),
    ("каждую неделю отчёт", "сегодня отчёт", "weekly"),
    ("10-го числа каждого месяца оплатить ЖКУ", "10 ноября оплатить ЖКУ", "monthly"),
    ("каждое 20-е число платить за интернет", "20 октября платить за интернет", "monthly"),
    ("каждый месяц 15-го числа оплатить аренду", "15 октября оплатить аренду", "monthly"),
    ("ежемесячно продлевать подписку", "сегодня продлевать подписку", "monthly"),
])
def test_detects_the_rule_and_rewrites_to_the_first_date(text, expected, freq):
    d = detect(text, THU)
    assert d is not None
    assert (d.text, d.freq) == (expected, freq)


def test_weekdays_start_today_on_a_weekday_and_on_monday_at_the_weekend():
    assert detect("по будням зарядка в 7", THU).text == "сегодня зарядка в 7"
    assert detect("каждый будний день стендап в 10", SAT).text == "в понедельник стендап в 10"
    assert detect("по будням зарядка в 7", THU).freq == "weekdays"


def test_the_31st_in_a_short_month_is_its_last_day():
    assert detect("31 числа каждого месяца отчёт", date(2027, 2, 3)).text == "28 февраля отчёт"


@pytest.mark.parametrize("text", [
    "каждый день зарядка",          # привычка, как и раньше
    "ежедневно читать 20 минут",
    "в понедельник созвон",
    "кофе 100",
    "по пути купить хлеб",
    "32-го числа каждого месяца",
])
def test_leaves_other_text_alone(text):
    assert detect(text, THU) is None
