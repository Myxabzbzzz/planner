from datetime import date, datetime, timedelta, timezone

from planner_worker.schemas import ExtractedItem, InboxRow
from planner_worker.validate import check_item, localize


def item(**kw) -> ExtractedItem:
    base = {"kind": "task", "title": "Дело", "source_text": "дело"}
    return ExtractedItem(**{**base, **kw})


def test_localize_attaches_user_tz_to_naive_datetime(ctx):
    it = localize(item(kind="event", starts_at=datetime(2026, 10, 2, 15, 0)), ctx)
    assert it.starts_at.astimezone(timezone.utc) == datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


def test_localize_ignores_llm_offset_and_uses_user_tz(ctx):
    llm_dt = datetime(2026, 10, 2, 15, 0, tzinfo=timezone(timedelta(hours=3)))
    it = localize(item(kind="event", starts_at=llm_dt), ctx)
    assert it.starts_at.astimezone(timezone.utc) == datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


def test_localize_uppercases_currency_and_defaults_date(ctx):
    it = localize(item(kind="expense", amount=22.4, currency=" usd "), ctx)
    assert it.currency == "USD"
    assert it.occurred_on == date(2026, 10, 1)


def test_event_without_time_is_error(ctx):
    errs = check_item(localize(item(kind="event"), ctx), ctx, None)
    assert any("starts_at" in e for e in errs)


def test_expense_without_amount_is_error(ctx):
    errs = check_item(localize(item(kind="expense"), ctx), ctx, None)
    assert any("суммы" in e for e in errs)


def test_unknown_currency_is_error(ctx):
    errs = check_item(localize(item(kind="expense", amount=5, currency="XYZ"), ctx), ctx, {"USD", "UZS"})
    assert errs == ["неизвестная валюта XYZ"]


def test_date_far_in_future_is_error(ctx):
    errs = check_item(localize(item(due_at=datetime(2031, 1, 1, 9, 0)), ctx), ctx, None)
    assert any("due_at" in e for e in errs)


def test_unknown_habit_is_error(ctx):
    errs = check_item(localize(item(kind="habit_done", habit="бег"), ctx), ctx, None)
    assert any("бег" in e for e in errs)


def test_known_habit_case_insensitive_ok(ctx):
    assert check_item(localize(item(kind="habit_done", habit="Зарядка"), ctx), ctx, None) == []


def test_valid_expense_ok(ctx):
    assert check_item(localize(item(kind="expense", amount=40000), ctx), ctx, {"UZS"}) == []


def test_inbox_row_from_db_defaults_result():
    row = InboxRow.from_db({"id": "i1", "user_id": "u1", "source": "text", "text": "x", "audio_ref": None,
                            "attempts": 1, "result": None, "reply_chat_id": 5, "reply_message_id": 6,
                            "status": "processing"})
    assert row.result == {}
    assert row.reply_message_id == 6
