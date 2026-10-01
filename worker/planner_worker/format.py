from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from .fx import FxApplied
from .schemas import ExtractedItem, UserContext

KIND_LABELS: dict[str, str] = {
    "task": "☑️ Задача",
    "event": "📅 Встреча",
    "expense": "💸 Расход",
    "income": "💰 Доход",
    "note": "💡 Мысль",
    "journal": "📔 Дневник",
    "habit_done": "🔁 Привычка",
    "habit_new": "➕ Новая привычка",
}
SYMBOLS = {"RUB": "₽", "USD": "$", "EUR": "€", "UZS": "сум", "KZT": "₸"}
REVIEW_ROWS = [["task", "event"], ["expense", "income"], ["note", "journal"], ["habit_done", "habit_new"]]


def fmt_number(x: Decimal) -> str:
    s = f"{x.quantize(Decimal('0.01'), ROUND_HALF_UP):,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


def fmt_amount(amount: Decimal, currency: str) -> str:
    return f"{fmt_number(amount)} {SYMBOLS.get(currency, currency)}"


def _dt(v: datetime, ctx: UserContext) -> str:
    return v.astimezone(ZoneInfo(ctx.tz)).strftime("%d.%m %H:%M")


def _clip(s: str, n: int = 200) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def render_line(item: ExtractedItem, fx: FxApplied | None, ctx: UserContext) -> str:
    k = item.kind
    if k == "task":
        return f"☑️ {item.title}" + (f" — до {_dt(item.due_at, ctx)}" if item.due_at else "")
    if k == "event":
        line = f"📅 {item.title} — {_dt(item.starts_at, ctx)}"
        if item.with_whom and item.with_whom.lower() not in item.title.lower():
            line += f" ({item.with_whom})"
        return line
    if k in ("expense", "income"):
        icon = "💸" if k == "expense" else "💰"
        base = fx.amount_base if fx else Decimal(str(item.amount))
        line = f"{icon} {item.title} — {fmt_amount(base, ctx.base_currency)}"
        if fx:
            orig = fmt_amount(fx.amount_orig, fx.currency_orig)
            if fx.rate >= 1:
                line += f"\n      {orig} по курсу {fmt_number(fx.rate)} на {fx.rate_date:%d.%m.%Y}"
            else:
                line += (f"\n      {orig} по курсу 1 {SYMBOLS.get(ctx.base_currency, ctx.base_currency)} = "
                         f"{fmt_number(1 / fx.rate)} {SYMBOLS.get(fx.currency_orig, fx.currency_orig)} "
                         f"на {fx.rate_date:%d.%m.%Y}")
        return line
    if k == "note":
        return f"💡 {_clip(item.title)}"
    if k == "journal":
        return f"📔 {_clip(item.title)}"
    if k == "habit_done":
        return f"🔁 {item.habit} — отмечено"
    return f"➕ Новая привычка: {item.title.strip()}"


def render_summary(lines: list[str], review_count: int) -> str:
    if not lines and not review_count:
        return "🤷 Не нашёл, что записать. Переформулируй?"
    if not lines:
        return f"❓ Уточни {review_count} — ниже."
    text = "✅ Записал:\n" + "\n".join(lines)
    if review_count:
        text += f"\n\n❓ Уточни ещё {review_count} — ниже."
    return _clip(text, 4000)


def summary_buttons(inbox_id: str) -> list[list[dict]]:
    return [[{"text": "🗑 Удалить всё", "callback_data": f"del:{inbox_id}"}]]


def review_message(inbox_id: str, idx: int, item: ExtractedItem, reason: str) -> tuple[str, list[list[dict]]]:
    text = f"❓ Куда отнести: «{item.source_text}»?"
    if reason and reason != "laya":
        text += f"\n({reason})"
    buttons = [[{"text": KIND_LABELS[k], "callback_data": f"rv:{inbox_id}:{idx}:{k}"} for k in row]
               for row in REVIEW_ROWS]
    buttons.append([{"text": "🗑 Пропустить", "callback_data": f"rv:{inbox_id}:{idx}:drop"}])
    return text, buttons
