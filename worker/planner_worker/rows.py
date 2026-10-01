from datetime import datetime, timezone
from decimal import Decimal

from .fx import FxApplied
from .schemas import ExtractedItem, UserContext


def _utc(v: datetime | None) -> str | None:
    return v.astimezone(timezone.utc).isoformat() if v else None


def to_row(item: ExtractedItem, ctx: UserContext, inbox_id: str, fx: FxApplied | None) -> tuple[str, dict]:
    base = {"user_id": ctx.user_id, "inbox_id": inbox_id}
    k = item.kind
    if k == "task":
        return "items", {**base, "kind": "task", "title": item.title, "due_at": _utc(item.due_at),
                         "priority": item.priority}
    if k == "event":
        return "items", {**base, "kind": "event", "title": item.title, "starts_at": _utc(item.starts_at),
                         "duration_min": item.duration_min, "with_whom": item.with_whom}
    if k in ("expense", "income"):
        cats = ctx.expense_categories if k == "expense" else ctx.income_categories
        cat_id = cats.get((item.category or "").strip().lower()) or cats.get("другое")
        row = {**base, "type": k, "base_currency": ctx.base_currency, "category_id": cat_id,
               "comment": item.title, "occurred_at": item.occurred_on.isoformat()}
        if fx:
            row |= {"amount_base": str(fx.amount_base), "amount_orig": str(fx.amount_orig),
                    "currency_orig": fx.currency_orig, "fx_rate": str(fx.rate),
                    "fx_date": fx.rate_date.isoformat(), "fx_source": fx.source}
        else:
            row["amount_base"] = str(Decimal(str(item.amount)).quantize(Decimal("0.01")))
        return "transactions", row
    if k in ("note", "journal"):
        return "notes", {**base, "kind": "thought" if k == "note" else "journal", "text": item.title}
    if k == "habit_done":
        return "habit_logs", {**base, "habit_id": ctx.habits[item.habit.strip().lower()],
                              "date": ctx.now.date().isoformat()}
    return "habits", {"user_id": ctx.user_id, "name": item.title.strip()}
