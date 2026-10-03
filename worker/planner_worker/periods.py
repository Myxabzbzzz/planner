from dataclasses import dataclass
from datetime import date, timedelta

MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь",
              "ноябрь", "декабрь"]
MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
              "ноября", "декабря"]
MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре",
               "ноябре", "декабре"]
DAY = timedelta(days=1)


@dataclass(frozen=True)
class Period:
    start: date | None  # включительно; None — без границы
    end: date | None    # исключительно; None — без границы
    phrase: str         # «в сентябре», «сегодня», «на этой неделе»
    short: str          # «сентябрь», «сегодня», «эта неделя»


def _add_months(first: date, n: int) -> date:
    y, m = divmod(first.month - 1 + n, 12)
    return date(first.year + y, m + 1, 1)


def _year(y: int, today: date) -> str:
    return "" if y == today.year else f" {y}"


def day_period(d: date, today: date) -> Period:
    label = {0: "сегодня", -1: "вчера", 1: "завтра"}.get((d - today).days) or f"{d.day} {MONTHS_GEN[d.month - 1]}"
    return Period(d, d + DAY, label, label)


def week_period(monday: date, today: date) -> Period:
    this_monday = today - timedelta(days=today.weekday())
    named = {0: ("на этой неделе", "эта неделя"), -1: ("на прошлой неделе", "прошлая неделя"),
             1: ("на следующей неделе", "следующая неделя")}
    since = f"{monday.day} {MONTHS_GEN[monday.month - 1]}"
    phrase, short = named.get((monday - this_monday).days // 7, (f"на неделе с {since}", f"неделя с {since}"))
    return Period(monday, monday + timedelta(days=7), phrase, short)


def month_period(year: int, month: int, today: date) -> Period:
    first = date(year, month, 1)
    suffix = _year(year, today)
    return Period(first, _add_months(first, 1), f"в {MONTHS_PREP[month - 1]}{suffix}",
                  f"{MONTHS_NOM[month - 1]}{suffix}")


def span_period(start: date, end: date) -> Period:
    last = end - DAY
    return Period(start, end, f"с {start:%d.%m} по {last:%d.%m}", f"{start:%d.%m}–{last:%d.%m}")


def resolve_period(code: str, today: date) -> Period:
    monday = today - timedelta(days=today.weekday())
    first = today.replace(day=1)
    if code == "today":
        return day_period(today, today)
    if code == "yesterday":
        return day_period(today - DAY, today)
    if code == "tomorrow":
        return day_period(today + DAY, today)
    if code == "this_week":
        return week_period(monday, today)
    if code == "last_week":
        return week_period(monday - timedelta(days=7), today)
    if code == "next_week":
        return week_period(monday + timedelta(days=7), today)
    if code == "this_month":
        return month_period(today.year, today.month, today)
    if code == "last_month":
        prev = _add_months(first, -1)
        return month_period(prev.year, prev.month, today)
    if code == "next_7_days":
        return Period(today, today + timedelta(days=7), "в ближайшие 7 дней", "ближайшие 7 дней")
    if code == "all_time":
        return Period(None, None, "за всё время", "всё время")
    if code.startswith("month:"):
        y, m = int(code[6:10]), int(code[11:13])
        while (y, m) > (today.year, today.month):  # «в декабре» в октябре — прошлый декабрь
            y -= 1
        return month_period(y, m, today)
    raise ValueError(f"unknown period: {code}")


def previous_period(p: Period, today: date) -> Period | None:
    if p.start is None or p.end is None:
        return None
    if p.start.day == 1 and p.end == _add_months(p.start, 1):
        prev = _add_months(p.start, -1)
        return month_period(prev.year, prev.month, today)
    length = p.end - p.start
    start = p.start - length
    if length.days == 1:
        return day_period(start, today)
    if length.days == 7 and start.weekday() == 0:
        return week_period(start, today)
    return span_period(start, p.start)


def compare_periods(code1: str | None, code2: str | None, today: date) -> tuple[Period, Period] | None:
    if code1 is None and code2 is None:
        first = today.replace(day=1)
        prev_first = _add_months(first, -1)
        prev_end = min(prev_first + timedelta(days=today.day), first)
        cur_short = f"{MONTHS_NOM[today.month - 1]} (1–{today.day})"
        prev_short = (f"{MONTHS_NOM[prev_first.month - 1]}{_year(prev_first.year, today)} "
                      f"(1–{(prev_end - DAY).day})")
        return (Period(first, today + DAY, cur_short, cur_short),
                Period(prev_first, prev_end, prev_short, prev_short))
    if code1 is None:
        code1, code2 = code2, None
    p1 = resolve_period(code1, today)
    p2 = resolve_period(code2, today) if code2 else previous_period(p1, today)
    return (p1, p2) if p2 else None
