import re
from datetime import date, datetime, timedelta

from .schemas import Extraction, Question, UserContext

EXTRACTION_SCHEMA: dict = Extraction.model_json_schema()
QUESTION_SCHEMA: dict = Question.model_json_schema()

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
- У задачи глагол действия остаётся в title, а перечисление при одном глаголе — одна задача: «купить молоко и хлеб» → одна task «Купить молоко и хлеб».
- Направление денег: «потратил, купил, заплатил, скинул, перевёл, отправил, отдал кому-то» — expense; «получил, заработал, вернули мне, перевели мне, пришла зарплата» — income. «Скинул маме 200 долларов» — expense с title «Маме».
- Для трат и доходов title — на что потрачено, кому отдано или откуда деньги: «потратил 250 000 на Claude» → «Claude», «заработал 380 000 с продажи футболки» → «Продажа футболки», «кофе 40 000» → «Кофе». Только если повод не назван совсем («потратил 200 000») — «Трата» или «Доход».
- Сервисы и подписки (Claude, ChatGPT, Netflix, Spotify, iCloud, YouTube) — категория «подписки», если она есть у пользователя.
- source_text — дословный фрагмент сообщения, к которому относится запись.
- Даты и время — локальные, формат YYYY-MM-DDTHH:MM:SS, без часового пояса. Относительные даты («завтра», «в пятницу») считай от текущего момента.
- Для дней недели и относительных дат бери дату из строки «Календарь» — ближайший будущий такой день (сегодняшний день недели = сегодня).
- Если после слова стоит дата в скобках (YYYY-MM-DD) — используй именно её.
- Если после времени стоит время в скобках (ЧЧ:ММ) — используй именно его. Если время не названо — не придумывай его.
- Несколько сумм подряд («потратил 290 и 60 и ещё 100») — отдельная запись на каждую сумму; суммы никогда не складывай.
- Суммы: «40 000» → 40000, «22,4» → 22.4, «пятьсот» → 500, «2к» → 2000.
- Вопросы и просьбы к самому боту («можешь написать код?», «что такое инфляция?», «расскажи анекдот», «привет») — не записи: items: []. Но свои идеи и размышления с вопросом («а что если открыть кофейню?») — note.
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


_MONTHS_GEN = ["январ", "феврал", "март", "апрел", "ма[яй]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"]
_NUMERIC_DATE_RE = re.compile(
    r"(?<![\w.,:])(?<!в )(?<!к )(?P<d>\d{1,2})\.(?P<m>\d{2})(?:\.(?P<y>\d{4}|\d{2}))?(?![\d.,])"
    r"(?!\s*(?:\$|€|₽|[a-zа-яё]*(?:долл|сум|руб|евр|тенге|тыс|usd|eur|rub|uzs|kzt)))"
    r"(?!\s*\(\d{4}-\d{2}-\d{2}\))",
    re.IGNORECASE,
)
_WORD_DATE_RE = re.compile(
    r"(?<![\w.,])(?P<d>\d{1,2})\s+(?P<mon>" + "|".join(_MONTHS_GEN) + r")[а-яё]*(?:\s+(?P<y>\d{4}))?(?!\w)"
    r"(?!\s*\(\d{4}-\d{2}-\d{2}\))",
    re.IGNORECASE,
)


def _explicit_date(day: int, month: int, year: int | None, today: date) -> date | None:
    try:
        if year is not None:
            return date(year + 2000 if year < 100 else year, month, day)
        d = date(today.year, month, day)
    except ValueError:
        return None
    # без года — ближайшая такая дата: ±полгода от сегодня
    if (d - today).days < -183:
        d = d.replace(year=d.year + 1)
    elif (d - today).days > 183:
        d = d.replace(year=d.year - 1)
    return d


def _annotate_explicit(text: str, today: date) -> str:
    def num(m: re.Match) -> str:
        y = m.group("y")
        d = _explicit_date(int(m.group("d")), int(m.group("m")), int(y) if y else None, today)
        return m.group(0) if d is None else f"{m.group(0)} ({d.isoformat()})"

    def word(m: re.Match) -> str:
        mon = next(i for i, p in enumerate(_MONTHS_GEN) if re.match(p, m.group("mon"), re.IGNORECASE)) + 1
        y = m.group("y")
        d = _explicit_date(int(m.group("d")), mon, int(y) if y else None, today)
        return m.group(0) if d is None else f"{m.group(0)} ({d.isoformat()})"

    return _WORD_DATE_RE.sub(word, _NUMERIC_DATE_RE.sub(num, text))


_IN_TIME_RE = re.compile(
    r"(?<!\w)через\s+(?:(?P<half>полчаса)|(?:(?P<n>\d{1,3}|полтора|" + "|".join(_NUM_WORDS) + r")\s+)?"
    r"(?P<u>минут[уы]?|мин|час(?:а|ов)?))(?!\w)(?!\s*\(\d{4}-\d{2}-\d{2}\))",
    re.IGNORECASE,
)


def annotate_in_time(text: str, now: datetime) -> str:
    """«через 35 минут» → «через 35 минут (2026-10-03) (19:50)»: точный момент считает код."""
    def rep(m: re.Match) -> str:
        if m.group("half"):
            delta = timedelta(minutes=30)
        else:
            raw = (m.group("n") or "1").lower()
            n = 1.5 if raw == "полтора" else int(raw) if raw.isdigit() else _NUM_WORDS[raw]
            delta = timedelta(minutes=n) if m.group("u").lower().startswith("мин") else timedelta(hours=n)
        at = (now + delta).replace(second=0, microsecond=0)
        return f"{m.group(0)} ({at.date().isoformat()}) ({at:%H:%M})"

    return _IN_TIME_RE.sub(rep, text)


_LIST_COMMA_RE = re.compile(r"(?<=\d)\s+,\s*(?=\d)|(?<=\d),\s+(?=\d)")
_COMMA_CHAIN_RE = re.compile(r"(?<![\d.,])\d+(?:,\d+){2,}(?![\d,])")


def split_number_lists(text: str) -> str:
    """«290 ,60», «200, 300» и цепочки «290,60,80» — перечисление: «290 и 60 и 80». «22,4» не трогаем."""
    text = _COMMA_CHAIN_RE.sub(lambda m: m.group(0).replace(",", " и "), text)
    return _LIST_COMMA_RE.sub(" и ", text)


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
    text = _annotate_explicit(text, today)

    def rep(m: re.Match) -> str:
        w = m.group(1)
        is_weekday = w.lower() not in ("сегодня", "завтра", "послезавтра")
        if is_weekday and re.search(r"\(\d{4}-\d{2}-\d{2}\)", text[m.end():m.end() + 40]):
            return w  # «в воскресенье следующее 11.10» — явная дата важнее дня недели
        return f"{w} ({resolve(w).isoformat()})"

    return _DATE_RE.sub(rep, text)


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


_ONLY_NUMBERS_RE = re.compile(r"[\d\s.,]*\d[\d\s.,]*")


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
    if _ONLY_NUMBERS_RE.fullmatch(text.strip()):
        user += "Сообщение состоит только из чисел — это траты (expense), по одной записи на каждое число, title «Трата».\n"
    if feedback:
        user += "Прошлый разбор содержал ошибки, исправь их:\n- " + "\n- ".join(feedback) + "\n"
    text = annotate_in_time(split_number_lists(text), ctx.now)
    user += f"\nСообщение:\n{annotate_times(annotate_dates(text, today))}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


QUESTION_SYSTEM = """Ты — разборщик вопросов к личному планеру. Определи, что спрашивает пользователь, и верни JSON строго по схеме. Ничего не считай и не отвечай сам.

intent:
- spent — сколько потрачено (за период, можно в категории). «сколько потратил на такси в сентябре», «сколько ушло за неделю».
- income — сколько получено или заработано. «какой доход в этом месяце», «сколько заработал в сентябре».
- top_categories — на что больше всего тратится, разбивка по категориям. «на что больше всего трачу», «покажи траты по категориям».
- limit_left — сколько осталось до лимита (бюджета) месяца. «сколько осталось до лимита», «какой у меня лимит».
- compare — сравнить траты двух периодов. «сравни с прошлым месяцем», «сравни эту неделю и прошлую».
- agenda — что запланировано (встречи и задачи со сроком) на день или неделю. «что у меня завтра», «какие встречи на неделе».
- open_tasks — какие задачи не сделаны. «что не сделано», «какие задачи висят».
- find_event — когда встреча с кем-то или про что-то. «когда встреча с Ахмедом», «когда стоматолог».
- unknown — вопрос не про траты, доходы, лимит, задачи или встречи (погода, факты, привычки, заметки).

Поля:
- category — только для spent, income, compare, limit_left и только если категория названа явно: точное название из списка категорий пользователя (для income — из категорий доходов). Иначе null.
- period — today, yesterday, tomorrow, this_week, last_week, next_week, this_month, last_month, next_7_days, all_time или month:YYYY-MM («в сентябре» → month:<текущий год>-09). «за неделю» = this_week, «за месяц» = this_month, «ближайшие дни» = next_7_days. Если период не назван — null.
- period2 — только для compare: второй период, если назван явно. Иначе null.
- query — только для find_event: имя человека или главное слово из названия встречи в именительном падеже («с Ахмедом» → «Ахмед», «со стоматологом» → «стоматолог»). Иначе null.
"""


def build_question_messages(text: str, ctx: UserContext) -> list[dict]:
    user = (
        f"Сегодня: {ctx.now:%Y-%m-%d} ({WEEKDAYS[ctx.now.weekday()]}).\n"
        f"Категории расходов: {', '.join(ctx.expense_categories)}.\n"
        f"Категории доходов: {', '.join(ctx.income_categories)}.\n"
        f"\nВопрос:\n{text}"
    )
    return [{"role": "system", "content": QUESTION_SYSTEM}, {"role": "user", "content": user}]
