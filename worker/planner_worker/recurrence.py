"""Повтор в тексте: «каждый понедельник созвон», «10-го числа каждого месяца оплатить ЖКУ».

Модель повторы не понимает и путает их с привычками («каждый день» в промпте — это habit_new).
Поэтому фразу повтора находим здесь, заменяем на дату первого раза («в понедельник»,
«10 ноября») и отдаём модели обычную задачу или встречу. Правило повтора приклеиваем сами.
«Каждый день» и «ежедневно» не трогаем — это по-прежнему привычки; ежедневный повтор
ставится в мини-приложении.
"""
import re
from dataclasses import dataclass
from datetime import date

# винительный падеж: «в понедельник», «в среду»
_DAYS = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]
_EVERY_DAY_RE = re.compile(
    r"(?<!\w)(?:кажд(?:ый|ую|ое)\s+(?P<every>понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресенье)"
    r"|по\s+(?P<plural>понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям))(?!\w)",
    re.IGNORECASE,
)
_PLURAL_STEMS = ["понедельник", "вторник", "сред", "четверг", "пятниц", "суббот", "воскресень"]
_WEEKDAYS_RE = re.compile(r"(?<!\w)(?:по\s+будням|кажд(?:ый|ые)\s+будни(?:й|е)\s+(?:день|дни))(?!\w)", re.IGNORECASE)
_EVERY_WEEK_RE = re.compile(r"(?<!\w)(?:каждую\s+неделю|еженедельно)(?!\w)", re.IGNORECASE)
# «10-го числа каждого месяца», «каждое 10-е число», «каждый месяц 10-го», «ежемесячно 5 числа»
_MONTH_DAY_RE = re.compile(
    r"(?<!\w)(?:"
    r"(?P<a>\d{1,2})(?:-?(?:го|е))?\s+числа\s+каждого\s+месяца"
    r"|каждое\s+(?P<b>\d{1,2})(?:-?е)?\s+число"
    r"|(?:каждый\s+месяц|ежемесячно)\s+(?P<c>\d{1,2})(?:-?го)?(?:\s+числа)?"
    r")(?!\w)",
    re.IGNORECASE,
)
_EVERY_MONTH_RE = re.compile(r"(?<!\w)(?:каждый\s+месяц|ежемесячно)(?!\w)", re.IGNORECASE)

_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
               "ноября", "декабря"]


@dataclass(frozen=True)
class Detected:
    text: str  # текст для модели: фраза повтора заменена датой первого раза
    freq: str  # weekdays | weekly | monthly


def _month_day(day: int, today: date) -> date:
    """Ближайшее такое число, начиная с сегодня; 31-е в коротком месяце — последний день."""
    y, m = today.year, today.month
    for _ in range(2):
        last = (date(y + (m == 12), m % 12 + 1, 1) - date(y, m, 1)).days
        d = date(y, m, min(day, last))
        if d >= today:
            return d
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return d


def _swap(text: str, m: re.Match, replacement: str) -> str:
    return text[:m.start()] + replacement + text[m.end():]


def detect(text: str, today: date) -> Detected | None:
    if m := _EVERY_DAY_RE.search(text):
        if m.group("every"):
            word = m.group("every").lower()
            idx = next(i for i, d in enumerate(_DAYS) if word[:4] == d[:4])
        else:
            word = m.group("plural").lower()
            idx = next(i for i, s in enumerate(_PLURAL_STEMS) if word.startswith(s))
        return Detected(_swap(text, m, f"в {_DAYS[idx]}"), "weekly")
    if m := _WEEKDAYS_RE.search(text):
        first = "сегодня" if today.isoweekday() <= 5 else "в понедельник"
        return Detected(_swap(text, m, first), "weekdays")
    if m := _MONTH_DAY_RE.search(text):
        day = int(m.group("a") or m.group("b") or m.group("c"))
        if not 1 <= day <= 31:
            return None
        d = _month_day(day, today)
        return Detected(_swap(text, m, f"{d.day} {_MONTHS_GEN[d.month - 1]}"), "monthly")
    if m := _EVERY_WEEK_RE.search(text):
        return Detected(_swap(text, m, "сегодня"), "weekly")
    if m := _EVERY_MONTH_RE.search(text):
        return Detected(_swap(text, m, "сегодня"), "monthly")
    return None


LABELS = {"weekdays": "по будням", "weekly": "каждую неделю", "monthly": "каждый месяц"}
