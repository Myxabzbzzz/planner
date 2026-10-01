from .schemas import Extraction, UserContext

EXTRACTION_SCHEMA: dict = Extraction.model_json_schema()

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
- title — коротко, по-русски, без даты и суммы: «Встреча с Андреем», «Такси», «Оплатить интернет». Для note и journal title — полный текст мысли.
- source_text — дословный фрагмент сообщения, к которому относится запись.
- Даты и время — локальные, формат YYYY-MM-DDTHH:MM:SS, без часового пояса. Относительные даты («завтра», «в пятницу») считай от текущего момента. «В 3» без уточнения — 15:00.
- Суммы: «40 000» → 40000, «22,4» → 22.4, «пятьсот» → 500, «2к» → 2000.
- Ничего не выдумывай. Если записей нет — items: [].
"""


def build_extract_messages(
    text: str, ctx: UserContext, hint_kind: str | None = None, feedback: list[str] | None = None
) -> list[dict]:
    weekday = WEEKDAYS[ctx.now.weekday()]
    user = (
        f"Сейчас: {ctx.now:%Y-%m-%dT%H:%M} ({weekday}), часовой пояс {ctx.tz}.\n"
        f"Базовая валюта: {ctx.base_currency}.\n"
        f"Категории расходов: {', '.join(ctx.expense_categories)}.\n"
        f"Категории доходов: {', '.join(ctx.income_categories)}.\n"
        f"Привычки: {', '.join(ctx.habits) or 'нет'}.\n"
    )
    if hint_kind:
        user += f"Пользователь уточнил: это запись типа {hint_kind}. Верни ровно одну запись этого типа.\n"
    if feedback:
        user += "Прошлый разбор содержал ошибки, исправь их:\n- " + "\n- ".join(feedback) + "\n"
    user += f"\nСообщение:\n{text}"
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]
