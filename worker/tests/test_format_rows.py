from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from planner_worker.format import fmt_amount, render_line, render_summary, review_message, summary_buttons
from planner_worker.fx import FxApplied
from planner_worker.rows import to_row
from planner_worker.schemas import ExtractedItem
from planner_worker.validate import localize

TZ = ZoneInfo("Asia/Tashkent")
FX = FxApplied(Decimal("264738.31"), Decimal("22.4"), "USD", Decimal("11818.67475800"), date(2026, 10, 1),
               "open.er-api.com")


def it(ctx, **kw):
    return localize(ExtractedItem(**{"title": "x", "source_text": "x", **kw}), ctx)


def test_fmt_amount():
    assert fmt_amount(Decimal("264738.31"), "UZS") == "264 738,31 сум"
    assert fmt_amount(Decimal("40000"), "UZS") == "40 000 сум"
    assert fmt_amount(Decimal("22.4"), "USD") == "22,40 $"
    assert fmt_amount(Decimal("5"), "GBP") == "5 GBP"


def test_render_lines(ctx):
    assert render_line(it(ctx, kind="event", title="Встреча с Андреем", starts_at=datetime(2026, 10, 2, 15, 0)),
                       None, ctx) == "📅 Встреча с Андреем — 02.10 15:00"
    assert render_line(it(ctx, kind="task", title="Оплатить интернет"), None, ctx) == "☑️ Оплатить интернет"
    assert render_line(it(ctx, kind="expense", title="Кофе", amount=40000), None, ctx) == "💸 Кофе — 40 000 сум"
    assert render_line(it(ctx, kind="expense", title="Подписка", amount=22.4, currency="USD"), FX, ctx) == (
        "💸 Подписка — 264 738,31 сум\n      22,40 $ по курсу 11 818,67 на 01.10.2026")
    assert render_line(it(ctx, kind="habit_done", title="Зарядка", habit="зарядка"), None, ctx) == "🔁 зарядка — отмечено"


def test_render_summary_variants():
    assert render_summary(["☑️ A"], 0) == "✅ Записал:\n☑️ A"
    assert render_summary(["☑️ A"], 2) == "✅ Записал:\n☑️ A\n\n❓ Уточни ещё 2 — ниже."
    assert render_summary([], 1) == "❓ Уточни 1 — ниже."
    assert render_summary([], 0).startswith("🤷 Не нашёл, что записать")


def test_buttons_fit_callback_limit(ctx):
    inbox_id = "10000000-0000-0000-0000-000000000001"
    assert summary_buttons(inbox_id) == [[{"text": "🗑 Удалить всё", "callback_data": f"del:{inbox_id}"}]]
    text, buttons = review_message(inbox_id, 0, it(ctx, kind="habit_done", source_text="кофе 40 000"), "laya")
    assert "«кофе 40 000»" in text
    datas = [b["callback_data"] for row in buttons for b in row]
    assert f"rv:{inbox_id}:0:expense" in datas
    assert f"rv:{inbox_id}:0:drop" in datas
    assert all(len(d.encode()) <= 64 for d in datas)


def test_to_row_event_in_utc(ctx):
    table, row = to_row(it(ctx, kind="event", title="Встреча", starts_at=datetime(2026, 10, 2, 15, 0),
                           with_whom="Андрей"), ctx, "i1", None)
    assert table == "items"
    assert row["starts_at"] == "2026-10-02T10:00:00+00:00"
    assert row["kind"] == "event" and row["with_whom"] == "Андрей" and row["inbox_id"] == "i1"


def test_to_row_expense_base_currency(ctx):
    table, row = to_row(it(ctx, kind="expense", title="Кофе", amount=40000, category="Кафе"), ctx, "i1", None)
    assert table == "transactions"
    assert row["amount_base"] == "40000.00"
    assert row["base_currency"] == "UZS"
    assert row["category_id"] == "c-cafe"
    assert row["occurred_at"] == "2026-10-01"
    assert "amount_orig" not in row


def test_to_row_expense_converted(ctx):
    _, row = to_row(it(ctx, kind="expense", title="Подписка", amount=22.4, currency="USD", category="подписки"),
                    ctx, "i1", FX)
    assert row["amount_base"] == "264738.31"
    assert row["amount_orig"] == "22.4"
    assert row["currency_orig"] == "USD"
    assert row["fx_rate"] == "11818.67475800"
    assert row["fx_date"] == "2026-10-01"


def test_to_row_unknown_category_falls_back(ctx):
    _, row = to_row(it(ctx, kind="expense", title="Латте", amount=30000, category="кофейни"), ctx, "i1", None)
    assert row["category_id"] == "c-exp-other"


def test_to_row_notes_and_habits(ctx):
    assert to_row(it(ctx, kind="journal", title="Устал"), ctx, "i1", None) == (
        "notes", {"user_id": "u1", "inbox_id": "i1", "kind": "journal", "text": "Устал"})
    assert to_row(it(ctx, kind="habit_done", habit="Зарядка"), ctx, "i1", None) == (
        "habit_logs", {"user_id": "u1", "inbox_id": "i1", "habit_id": "h-gym", "date": "2026-10-01"})
    assert to_row(it(ctx, kind="habit_new", title=" Медитация "), ctx, "i1", None) == (
        "habits", {"user_id": "u1", "name": "Медитация"})
