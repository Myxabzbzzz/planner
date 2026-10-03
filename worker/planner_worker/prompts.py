import re
from datetime import date, timedelta

from .schemas import Extraction, UserContext

EXTRACTION_SCHEMA: dict = Extraction.model_json_schema()

SHORT_DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]

SYSTEM = """Ты — парсер личного планера. Раздели сообщение пользователя на отдельные записи и верни JSON строго по схеме.

Типы (kind):
- task — дело, которое нужно сделать («не забыть», «надо», «купить», «оплатить» в будущем). due_at — срок, если назван.
- event — встреча или событие в конкретное время. starts_at обязательно. with_whom — с кем.
- expense — уже потраченные деньги. amount — число. currency — ISO-код ТОЛЬКО если валюта названа явно («доллар»→USD, «рубль»→RUB, «сум»→UZS, «тенге»→KZT, «евро»→EUR), иначе null. category — одна из категорий пользователя.
- income — полученные деньги, поля как у expense.
- note — мысль, идея, заметка. journal — запись о прожитом дне, настроении, событиях.
- habit_done — пользователь сделал свою привычку; habit — точное название из списка привычек.
- habit_new — пользователь хочет начать отслеживать новую привычку; title — её короткое название.

Правила:
- title — коротко, по-русски, без даты, суммы и слов «потратил/купил/надо»: «Встреча с Андреем», «Такси», «Оплатить интернет». Для note и journal title — полный текст мысли.
- Направление денег: «потратил, купил, заплатил, скинул, перевёл, отправил, отдал кому-то» — expense; «получил, заработал, вернули мне, перевели мне, пришла зарплата» — income. «Скинул маме 200 долларов» — expense с title «Маме».
- Для трат и доходов title — на что потрачено, кому отдано или откуда деньги: «потратил 250 000 на Claude» → «Claude», «заработал 380 000 с продажи футболки» → «Продажа футболки», «кофе 40 000» → «Кофе». Только если повод не назван совсем («потратил 200 000») — «Трата» или «Доход».
- Сервисы и подписки (Claude, ChatGPT, Netflix, Spotify, iCloud, YouTube) — категория «подписки», если она есть у пользователя.
- source_text — дословный фрагмент сообщения, к которому относится запись.
- Даты и время — локальные, формат YYYY-MM-DDTHH:MM:SS, без часового пояса. Относительные даты («завтра», «в пятницу») считай от текущего момента.
- Для дней недели и относительных дат бери дату из строки «Календарь» — ближайший будущий такой день (сегодняшний день недели = сегодня).
- Если после слова стоит дата в скобках (YYYY-MM-DD) — используй именно её.
- Если после времени стоит время в скобках (ЧЧ:ММ) — используй именно его. Если время не названо — не придумывай его.
- Суммы: «40 000» → 40000, «22,4» → 22.4, «пятьсот» → 500, «2к» → 2000.
- Ничего не выдумывай. Если записей нет — items: [].
"""


_WEEKDAY_STEMS = [
    ("понедельник", r"понедельник(?:а)?"),
    ("вторник", r"вторник(?:а)?"),
    ("среда", r"сред(?:а|у|ы)"),
    ("четверг", r"четверг(?:а)?"),
    ("пятница", r"пят(?:ница|ницу|ницы)"),
    ("суббота", r"суббот(?:а|у|ы)"),
    ("воскресенье", r"воскресень(?:е|я)"),
]
_DATE_WORDS = r"послезавтра|завтра|сегодня|" + "|".join(p for _, p in _WEEKDAY_STEMS)
_DATE_RE = re.compile(rf"(?<!\w)({_DATE_WORDS})(?!\w)(?!\s*\(\d{{4}}-\d{{2}}-\d{{2}}\))", re.IGNORECASE)
_NUM_WORDS = {"один": 1, "одну": 1, "одного": 1, "два": 2, "две": 2, "пару": 2, "три": 3, "четыре": 4, "пять": 5,
              "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10}
_IN_RE = re.compile(
    r"(?<!\w)через\s+(?:(?P<n>\d{1,2}|" + "|".join(_NUM_WORDS) + r")\s+)?"
    r"(?P<u>день|дня|дней|неделю|недели|недель|месяц|месяца|месяцев)(?!\w)(?!\s*\(\d{4}-\d{2}-\d{2}\))",
    re.IGNORECASE,
)


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return d.replace(year=y, month=m, day=day)
        except ValueError:
            continue
    raise ValueError(d)


def _in_date(m: re.Match, today: date) -> date:
    raw = (m.group("n") or "1").lower()
    n = int(raw) if raw.isdigit() else _NUM_WORDS[raw]
    unit = m.group("u").lower()
    if unit.startswith("д"):
        return today + timedelta(days=n)
    if unit.startswith("н"):
        return today + timedelta(weeks=n)
    return _add_months(today, n)


def annotate_dates(text: str, today: date) -> str:
    def resolve(word: str) -> date:
        w = word.lower()
        if w == "сегодня":
            return today
        if w == "завтра":
            return today + timedelta(days=1)
        if w == "послезавтра":
            return today + timedelta(days=2)
        for idx, (_, pat) in enumerate(_WEEKDAY_STEMS):
            if re.fullmatch(pat, w):
                return today + timedelta(days=(idx - today.weekday()) % 7)
        raise ValueError(word)

    text = _IN_RE.sub(lambda m: f"{m.group(0)} ({_in_date(m, today).isoformat()})", text)
    return _DATE_RE.sub(lambda m: f"{m.group(1)} ({resolve(m.group(1)).isoformat()})", text)


_TIME_RE = re.compile(
    r"(?<!\w)(?:в|к)\s+(?:(?P<word>час|полдень|полночь)|пол(?P<half>первого|второго|третьего|четв[её]ртого|пятого"
    r"|шестого|седьмого|восьмого|девятого|десятого|одиннадцатого|двенадцатого)"
    r"|(?P<h>\d{1,2})(?:[:.](?P<m>\d{2}))?(?:\s+час(?:а|ов)?)?(?:\s+(?P<suf>утра|дня|вечера|ночи))?)"
    r"(?!\w)(?![:.]\d)(?!\s*\(\d{2}:\d{2}\))",
    re.IGNORECASE,
)
_BARE_TIME_RE = re.compile(
    r"(?<![\w:.])(?:(?P<word>час)|(?P<h>\d{1,2})(?:\s+час(?:а|ов)?)?)\s+(?P<suf>утра|дня|вечера|ночи)"
    r"(?!\w)(?!\s*\(\d{2}:\d{2}\))",
    re.IGNORECASE,
)
_TIME_WORDS = {"полдень": (12, 0), "полночь": (0, 0)}
_HALF_HOURS = ["первого", "второго", "третьего", "четвертого", "пятого", "шестого", "седьмого", "восьмого",
               "девятого", "десятого", "одиннадцатого", "двенадцатого"]


def _clock(m: re.Match) -> tuple[int, int] | None:
    g = m.groupdict()
    word = (g.get("word") or "").lower()
    if word in _TIME_WORDS:
        return _TIME_WORDS[word]
    if g.get("half"):
        h = _HALF_HOURS.index(g["half"].lower().replace("ё", "е"))  # «полвторого» = 1:30
        return (h + 12 if 1 <= h <= 7 else 12 if h == 0 else h), 30
    h, mi = (1, 0) if word == "час" else (int(g["h"]), int(g.get("m") or 0))
    if h > 23 or mi > 59:
        return None
    suf = (g.get("suf") or "").lower()
    if suf in ("утра", "ночи"):
        h = 0 if h == 12 else h
    elif suf in ("дня", "вечера"):
        h = h + 12 if h < 12 else h
    elif 1 <= h <= 7:
        h += 12  # «в 3» без уточнения — день
    return h, mi


def annotate_times(text: str) -> str:
    """«в час» → «в час (13:00)»: время считает код, модель только переписывает его."""
    def rep(m: re.Match) -> str:
        hm = _clock(m)
        return m.group(0) if hm is None else f"{m.group(0)} ({hm[0]:02d}:{hm[1]:02d})"

    return _BARE_TIME_RE.sub(rep, _TIME_RE.sub(rep, text))


def build_extract_messages(
    text: str, ctx: UserContext, hint_kind: str | None = None, feedback: list[str] | None = None
) -> list[dict]:
    weekday = WEEKDAYS[ctx.now.weekday()]
    today = ctx.now.date()
    cal = []
    for i in range(14):
        d = today + timedelta(days=i)
        label = "сегодня " if i == 0 else "завтра " if i == 1 else ""
        cal.append(f"{label}{SHORT_DAYS[d.weekday()]} {d.isoformat()}")
    user = (
        f"Сейчас: {ctx.now:%Y-%m-%dT%H:%M} ({weekday}), часовой пояс {ctx.tz}.\n"
        f"Календарь: {', '.join(cal)}.\n"
        f"Базовая валюта: {ctx.base_currency}.\n"
        f"Категории расходов: {', '.join(ctx.expense_categories)}.\n"
        f"Категории доходов: {', '.join(ctx.income_categories)}.\n"
        f"Привычки: {', '.join(ctx.habits) or 'нет'}.\n"
    )
    if hint_kind:
        user += f"Пользователь уточнил: это запись типа {hint_kind}. Верни ровно одну запись этого типа.\n"
    if feedback:
        user += "Прошлый разбор содержал ошибки, исправь их:\n- " + "\n- ".join(feedback) + "\n"
    user += f"\nСообщение:\n{annotate_times(annotate_dates(text, today))}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
