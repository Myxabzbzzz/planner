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
- title — коротко, по-русски, без даты, суммы и слов «потратил/купил/надо»: «Встреча с Андреем», «Такси», «Оплатить интернет»; «потратил 200$ на ерунду» → «Ерунда». Для note и journal title — полный текст мысли.
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

    return _DATE_RE.sub(lambda m: f"{m.group(1)} ({resolve(m.group(1)).isoformat()})", text)


_TIME_RE = re.compile(
    r"(?<!\w)(?:в|к)\s+(?:(?P<word>час|полдень|полночь)"
    r"|(?P<h>\d{1,2})(?:[:.](?P<m>\d{2}))?(?:\s+час(?:а|ов)?)?(?:\s+(?P<suf>утра|дня|вечера|ночи))?)"
    r"(?!\w)(?![:.]\d)(?!\s*\(\d{2}:\d{2}\))",
    re.IGNORECASE,
)
_TIME_WORDS = {"час": (13, 0), "полдень": (12, 0), "полночь": (0, 0)}


def _clock(m: re.Match) -> tuple[int, int] | None:
    if m.group("word"):
        return _TIME_WORDS[m.group("word").lower()]
    h, mi = int(m.group("h")), int(m.group("m") or 0)
    if h > 23 or mi > 59:
        return None
    suf = (m.group("suf") or "").lower()
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

    return _TIME_RE.sub(rep, text)


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
