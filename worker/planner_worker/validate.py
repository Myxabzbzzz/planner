import re
from datetime import timedelta
from zoneinfo import ZoneInfo

from .schemas import ExtractedItem, UserContext

CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def localize(item: ExtractedItem, ctx: UserContext) -> ExtractedItem:
    """Наивные даты от LLM — в часовом поясе пользователя; валюта — в верхнем регистре."""
    tz = ZoneInfo(ctx.tz)
    upd: dict = {}
    for f in ("due_at", "starts_at"):
        v = getattr(item, f)
        if v is not None and v.tzinfo is None:
            upd[f] = v.replace(tzinfo=tz)
    if item.currency:
        upd["currency"] = item.currency.strip().upper()
    if item.kind in ("expense", "income") and item.occurred_on is None:
        upd["occurred_on"] = ctx.now.date()
    return item.model_copy(update=upd)


def check_item(item: ExtractedItem, ctx: UserContext, known_currencies: set[str] | None) -> list[str]:
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
    if item.kind in ("expense", "income"):
        if item.amount is None or item.amount <= 0:
            errs.append("у операции нет суммы больше нуля")
        if item.currency is not None and (
            not CURRENCY_RE.match(item.currency)
            or (known_currencies is not None and item.currency not in known_currencies)
        ):
            errs.append(f"неизвестная валюта {item.currency}")
    if item.kind == "habit_done" and (item.habit or "").strip().lower() not in ctx.habits:
        names = ", ".join(ctx.habits) or "нет привычек"
        errs.append(f"привычки «{item.habit}» нет; есть: {names}")
    return errs
