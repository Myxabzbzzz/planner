import re
from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from .schemas import ExtractedItem, UserContext

NO_TIME = "у встречи не названо время"
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_ANNOTATION_RE = re.compile(r"\((?:\d{4}-\d{2}-\d{2}|\d{2}:\d{2})\)")
_CLOCK_RE = re.compile(r"(?<!\d)\d{1,2}:\d{2}(?!\d)")
_AMOUNT_RE = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)\s*(к|k|тыс\w*|тыщ\w*|млн|миллион\w*)?(?!\w)",
    re.IGNORECASE,
)
_CENT = Decimal("0.005")
_DATE_IN_TEXT_RE = re.compile(
    r"\(\d{4}-\d{2}-\d{2}\)|\b\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\b|\b\d{1,2}\s+(?:январ|феврал|март|апрел|ма[яй]|июн|июл|август"
    r"|сентябр|октябр|ноябр|декабр)",
    re.IGNORECASE,
)


def amounts_in(text: str) -> list[Decimal]:
    """Числа-суммы из текста пользователя («200$», «40 000», «22,4», «300к», «12 миллионов»).
    Аннотации дат/времени и время «15:30» не считаются."""
    clean = _CLOCK_RE.sub(" ", _ANNOTATION_RE.sub(" ", text))
    out = []
    for m in _AMOUNT_RE.finditer(clean):
        n = Decimal(re.sub(r"[ \u00a0]", "", m.group(1)) + (f".{m.group(2)}" if m.group(2) else ""))
        suf = (m.group(3) or "").lower()
        if suf:
            n *= 1000 if suf[0] in "кkт" else 1_000_000
        out.append(n)
    return out


def _amount_in(amount: float, nums: list[Decimal]) -> bool:
    a = Decimal(str(amount))
    return any(abs(a - n) < _CENT for n in nums)


def localize(item: ExtractedItem, ctx: UserContext, strict: bool = True) -> ExtractedItem:
    """Время от LLM — всегда «настенное» время пользователя: смещение, если модель его
    приписала, отбрасываем и ставим часовой пояс пользователя; валюта — в верхнем регистре."""
    tz = ZoneInfo(ctx.tz)
    upd: dict = {}
    for f in ("due_at", "starts_at"):
        v = getattr(item, f)
        if v is not None:
            upd[f] = v.replace(tzinfo=tz)
    if item.currency:
        upd["currency"] = item.currency.strip().upper()
    if item.kind in ("expense", "income") and item.occurred_on is None:
        upd["occurred_on"] = ctx.now.date()
    if item.kind in ("expense", "income") and item.amount is not None:
        # модель иногда портит числа — единственному числу из текста верим больше
        nums = amounts_in(item.source_text)
        if len(nums) == 1 and not _amount_in(item.amount, nums) and not _plain_number_in(item.amount, item.source_text):
            upd["amount"] = float(nums[0])
    if item.kind == "habit_done" and not (item.habit or "").strip() and item.title.strip().lower() in ctx.habits:
        upd["habit"] = item.title.strip().lower()  # модель часто кладёт привычку в title
    if item.kind == "task" and "due_at" in upd and not _has_clock(item.source_text):
        upd["due_at"] = upd["due_at"].replace(hour=23, minute=59, second=0, microsecond=0)
    if strict and item.kind == "event" and not _has_clock(item.source_text) and not _has_date(item.source_text):
        # ни даты, ни времени — модель выдумала бы «сейчас»; сохраняем как задачу без срока
        upd.update(kind="task", starts_at=None, due_at=None, duration_min=None)
    return item.model_copy(update=upd)


def _plain_number_in(amount: float, text: str) -> bool:
    """Сумма записана в тексте отдельным числом («290,60,80» → 60) — значит модель её не выдумала."""
    return any(Decimal(t) == Decimal(str(amount)) for t in re.findall(r"(?<![\d.])\d+(?![\d.])", text))


def _has_date(text: str) -> bool:
    return bool(_DATE_IN_TEXT_RE.search(text))


def _has_clock(text: str) -> bool:
    return bool(_CLOCK_RE.search(text))


def check_item(
    item: ExtractedItem, ctx: UserContext, known_currencies: set[str] | None, strict: bool = True
) -> list[str]:
    errs: list[str] = []
    if not item.title.strip():
        errs.append("title пустой")
    lo, hi = ctx.now - timedelta(days=366), ctx.now + timedelta(days=731)
    for f in ("due_at", "starts_at"):
        v = getattr(item, f)
        if v is not None and not (lo <= v <= hi):
            errs.append(f"{f} вне разумного диапазона: {v.isoformat()}")
    if item.kind == "event" and item.starts_at is None:
        errs.append("у встречи (event) нет starts_at")
    elif strict and item.kind == "event" and not _has_clock(item.source_text):
        errs.append(NO_TIME)
    if item.kind in ("expense", "income"):
        if item.amount is None or item.amount <= 0:
            errs.append("у операции нет суммы больше нуля")
        else:
            nums = amounts_in(item.source_text)
            if nums and not _amount_in(item.amount, nums):
                errs.append(f"сумма {item.amount} не совпадает с числами в тексте «{item.source_text}»")
        if item.currency is not None and (
            not CURRENCY_RE.match(item.currency)
            or (known_currencies is not None and item.currency not in known_currencies)
        ):
            errs.append(f"неизвестная валюта {item.currency}")
    if item.kind == "habit_done" and (item.habit or "").strip().lower() not in ctx.habits:
        names = ", ".join(ctx.habits) or "нет привычек"
        errs.append(f"привычки «{item.habit}» нет; есть: {names}")
    return errs
