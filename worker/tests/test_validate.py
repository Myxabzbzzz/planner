from datetime import date, datetime, timedelta, timezone

from planner_worker.schemas import ExtractedItem, InboxRow
from planner_worker.validate import check_item, localize


def item(**kw) -> ExtractedItem:
    base = {"kind": "task", "title": "Дело", "source_text": "дело"}
    return ExtractedItem(**{**base, **kw})


def test_localize_attaches_user_tz_to_naive_datetime(ctx):
    it = localize(item(kind="event", source_text="завтра (2026-10-02) в 3 (15:00) встреча", starts_at=datetime(2026, 10, 2, 15, 0)), ctx)
    assert it.starts_at.astimezone(timezone.utc) == datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


def test_localize_ignores_llm_offset_and_uses_user_tz(ctx):
    llm_dt = datetime(2026, 10, 2, 15, 0, tzinfo=timezone(timedelta(hours=3)))
    it = localize(item(kind="event", source_text="завтра (2026-10-02) в 3 (15:00) встреча", starts_at=llm_dt), ctx)
    assert it.starts_at.astimezone(timezone.utc) == datetime(2026, 10, 2, 10, 0, tzinfo=timezone.utc)


def test_localize_uppercases_currency_and_defaults_date(ctx):
    it = localize(item(kind="expense", amount=22.4, currency=" usd "), ctx)
    assert it.currency == "USD"
    assert it.occurred_on == date(2026, 10, 1)


def test_event_without_time_is_error(ctx):
    errs = check_item(localize(item(kind="event", source_text="завтра (2026-10-02) встреча"), ctx), ctx, None)
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


def test_amounts_in():
    from decimal import Decimal
    from planner_worker.validate import amounts_in
    assert amounts_in("потратил 200$ на ерунду") == [Decimal("200")]
    assert amounts_in("кофе 40 000 сум") == [Decimal("40000")]
    assert amounts_in("1 500 000 зарплата") == [Decimal("1500000")]
    assert amounts_in("подписка 22,4 доллара") == [Decimal("22.4")]
    assert amounts_in("такси 300к") == [Decimal("300000")]
    assert amounts_in("получил 12 миллионов") == [Decimal("12000000")]
    assert amounts_in("заплатил пятьсот рублей") == []
    assert amounts_in("сегодня (2026-10-03) в 15:30 (15:30) кофе 5 000") == [Decimal("5000")]


def test_localize_fixes_llm_amount_from_single_number_in_text(ctx):
    it = localize(item(kind="expense", amount=20000, currency="USD", source_text="потратил 200$ на ерунду"), ctx)
    assert it.amount == 200


def test_mismatched_amount_with_several_numbers_is_error(ctx):
    it = localize(item(kind="expense", amount=999, source_text="такси 25 тысяч и обед 60 000"), ctx)
    assert any("не совпадает" in e for e in check_item(it, ctx, None))


def test_matching_amount_among_several_numbers_ok(ctx):
    it = localize(item(kind="expense", amount=60000, source_text="такси 25 тысяч и обед 60 000"), ctx)
    assert check_item(it, ctx, None) == []


def test_task_without_time_in_text_is_due_end_of_day(ctx):
    it = localize(item(kind="task", source_text="надо сегодня (2026-10-01) оплатить подписку",
                       due_at=datetime(2026, 10, 1, 10, 0)), ctx)
    assert (it.due_at.hour, it.due_at.minute) == (23, 59)


def test_task_with_time_in_text_keeps_time(ctx):
    it = localize(item(kind="task", source_text="позвонить в 4 (16:00)", due_at=datetime(2026, 10, 1, 16, 0)), ctx)
    assert (it.due_at.hour, it.due_at.minute) == (16, 0)


def test_event_without_date_and_time_becomes_task(ctx):
    it = localize(item(kind="event", title="Встреча с Амиром", source_text="Встреча с Амиром",
                       starts_at=datetime(2026, 10, 1, 10, 0)), ctx)
    assert it.kind == "task"
    assert it.starts_at is None and it.due_at is None
    assert check_item(it, ctx, None) == []


def test_event_with_date_but_no_time_needs_review(ctx):
    it = localize(item(kind="event", title="Встреча с Амиром", source_text="завтра (2026-10-02) встреча с Амиром",
                       starts_at=datetime(2026, 10, 2, 10, 0)), ctx)
    assert it.kind == "event"
    assert any("время" in e for e in check_item(it, ctx, None))


def test_event_with_month_date_but_no_time_needs_review(ctx):
    it = localize(item(kind="event", title="Встреча", source_text="встреча 5 октября",
                       starts_at=datetime(2026, 10, 5, 10, 0)), ctx)
    assert it.kind == "event"
    assert any("время" in e for e in check_item(it, ctx, None))


def test_event_with_time_ok(ctx):
    it = localize(item(kind="event", title="Встреча", source_text="встреча в полвторого (13:30)",
                       starts_at=datetime(2026, 10, 1, 13, 30)), ctx)
    assert it.kind == "event"
    assert check_item(it, ctx, None) == []


def test_habit_done_takes_habit_from_title_when_missing(ctx):
    it = localize(item(kind="habit_done", title="Чтение", source_text="прочитал 20 страниц"), ctx)
    assert it.habit == "чтение"
    assert check_item(it, ctx, None) == []


def test_localize_keeps_amount_written_as_its_own_number(ctx):
    # «290,60,80» — модель разбила на три траты; 60 есть в тексте отдельным числом — не трогаем
    it = localize(item(kind="expense", amount=60, source_text="Я потратил 290,60,80."), ctx)
    assert it.amount == 60


def test_amounts_in_understands_tyshch():
    from decimal import Decimal
    from planner_worker.validate import amounts_in
    assert amounts_in("25 тыщ кофе") == [Decimal(25000)]
    assert amounts_in("2 тыщи на хлеб") == [Decimal(2000)]


def test_amounts_in_understands_thousand_dots():
    from decimal import Decimal
    from planner_worker.validate import amounts_in
    assert amounts_in("расходы 150.000 и 60.000,50.000,70.000,30.000") == [
        Decimal(150000), Decimal(60000), Decimal(50000), Decimal(70000), Decimal(30000)]
    assert amounts_in("1.250.000 сум") == [Decimal(1250000)]
    assert amounts_in("кофе 22.40") == [Decimal("22.40")]


def test_localize_keeps_model_amount_for_tyshch(ctx):
    it = ExtractedItem(kind="expense", title="Кофе", source_text="25 тыщ кофе", amount=25000)
    assert localize(it, ctx).amount == 25000


def test_localize_moves_weekday_money_to_the_past(ctx):
    # ctx.now — четверг 01.10; «в понедельник потратил» — прошедший понедельник 28.09
    it = item(kind="expense", title="Продукты", amount=100000,
              source_text="в понедельник (2026-10-05) потратил 100 000 на продукты", occurred_on=date(2026, 10, 5))
    assert localize(it, ctx).occurred_on == date(2026, 9, 28)


def test_future_money_date_is_an_error(ctx):
    from planner_worker.validate import FUTURE
    it = localize(item(kind="income", title="Зарплата", amount=5000000, source_text="10.10 (2026-10-10) зарплата 5 000 000",
                       occurred_on=date(2026, 10, 10)), ctx)
    assert it.occurred_on == date(2026, 10, 10)
    errs = check_item(it, ctx, None)
    assert len(errs) == 1 and errs[0].startswith(FUTURE)
    today = localize(item(kind="expense", title="Кофе", amount=40000, source_text="кофе 40 000"), ctx)
    assert check_item(today, ctx, None) == []


def test_day_part_counts_as_a_named_time(ctx):
    """«завтра вечером встреча» — время названо словом, спрашивать «во сколько?» не надо."""
    it = localize(item(kind="event", source_text="завтра (2026-10-02) вечером (19:00) встреча с Андреем",
                       starts_at=datetime(2026, 10, 2, 19, 0)), ctx)
    assert it.kind == "event"
    assert check_item(it, ctx, None) == []


def test_day_part_survives_lost_annotation(ctx):
    """Даже если модель скопировала фрагмент без аннотаций, «вечером» — это время."""
    it = localize(item(kind="event", source_text="завтра вечером встреча",
                       starts_at=datetime(2026, 10, 2, 19, 0)), ctx)
    assert it.kind == "event"
    assert check_item(it, ctx, None) == []


def test_task_keeps_word_time_instead_of_23_59(ctx):
    it = localize(item(kind="task", title="Оплатить интернет",
                       source_text="завтра вечером (19:00) оплатить интернет",
                       due_at=datetime(2026, 10, 2, 19, 0)), ctx)
    assert (it.due_at.hour, it.due_at.minute) == (19, 0)


def test_task_without_time_still_gets_23_59(ctx):
    it = localize(item(kind="task", title="Отчёт", source_text="до пятницы (2026-10-02) сдать отчёт",
                       due_at=datetime(2026, 10, 2, 12, 0)), ctx)
    assert (it.due_at.hour, it.due_at.minute) == (23, 59)
