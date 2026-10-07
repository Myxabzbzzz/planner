from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from planner_worker.classifier import Classification
from planner_worker.fx import FxError, RateTable
from planner_worker.llm import ExtractionError
from planner_worker.pipeline import Pipeline, notify_failed, run_one
from planner_worker.schemas import ExtractedItem, InboxRow

RATES = RateTable(date(2026, 10, 1), {"USD": Decimal("1"), "UZS": Decimal("11818.674758")}, "open.er-api.com")


class FakeStore:
    def __init__(self, ctx, rates=RATES):
        self.ctx, self.rates = ctx, rates
        self.inserted: list[tuple[str, dict]] = []
        self.finished: list[tuple] = []
        self.saved_rates = []
        self.failed: list[InboxRow] = []
        self.notified: list[str] = []
        self.cleared: list[str] = []
        self.events: list[str] = []

    def load_context(self, user_id, now_utc):
        return self.ctx

    def rates_on(self, d):
        return self.rates

    def save_rates(self, t):
        self.saved_rates.append(t)

    def insert(self, table, row):
        self.events.append("insert")
        self.inserted.append((table, row))

    def clear_records(self, inbox_id):
        self.events.append("clear")
        self.cleared.append(inbox_id)

    def finish(self, inbox_id, status, result, error=None, notified=False):
        self.finished.append((inbox_id, status, result, error, notified))

    def failed_unnotified(self):
        return self.failed

    def mark_notified(self, inbox_id):
        self.notified.append(inbox_id)


class FakeTg:
    def __init__(self):
        self.sent, self.edited = [], []

    def send(self, chat_id, text, buttons=None):
        self.sent.append((chat_id, text, buttons))
        return 900 + len(self.sent)

    def edit(self, chat_id, message_id, text, buttons=None):
        self.edited.append((chat_id, message_id, text, buttons))

    def download(self, file_id, dest_dir):
        return dest_dir / "v.oga"


class FakeExtractor:
    def __init__(self, *batches):
        self.batches = list(batches)
        self.calls = []

    def extract(self, text, ctx, hint_kind=None, feedback=None):
        self.calls.append({"text": text, "hint_kind": hint_kind, "feedback": feedback})
        batch = self.batches.pop(0)
        if isinstance(batch, Exception):
            raise batch
        return batch


class FakeClassifier:
    def __init__(self, mapping):
        self.mapping = mapping

    def classify(self, text):
        return self.mapping[text]


class FakeStt:
    def __init__(self, text):
        self.text = text

    def transcribe(self, path):
        return self.text


def item(**kw):
    return ExtractedItem(**{"title": "x", **kw})


def row(**kw):
    base = dict(id="i1", user_id="u1", source="text", text="t", audio_ref=None, attempts=1, result={},
                reply_chat_id=5, reply_message_id=77)
    return InboxRow(**{**base, **kw})


def make(ctx, extractor, classifier=None, stt=None, store=None, fetch=lambda: RATES):
    store = store or FakeStore(ctx)
    tg = FakeTg()
    p = Pipeline(store, tg, stt or FakeStt(""), extractor, classifier, fetch, 0.7, Path("/tmp/planner-test"))
    return p, store, tg


EVENT = item(kind="event", title="Встреча с Андреем", source_text="завтра (2026-10-02) в 3 (15:00) встреча с Андреем",
             starts_at=datetime(2026, 10, 2, 15, 0))
TAXI = item(kind="expense", title="Такси", source_text="30 000 на такси", amount=30000)


def test_accepts_items_when_laya_agrees(ctx):
    cls = FakeClassifier({EVENT.source_text: Classification("event", 0.99),
                          TAXI.source_text: Classification("expense", 0.98)})
    p, store, tg = make(ctx, FakeExtractor([EVENT, TAXI]), cls)
    p.process(row())
    assert [t for t, _ in store.inserted] == ["items", "transactions"]
    assert store.finished[-1][1] == "done"
    chat, mid, text, buttons = tg.edited[0]
    assert (chat, mid) == (5, 77)
    assert "📅 Встреча с Андреем — 02.10 15:00" in text and "💸 Такси — 30 000 сум" in text
    assert buttons[0][0]["callback_data"] == "del:i1"


def test_disagreement_goes_to_review(ctx):
    task = item(kind="task", title="Оплатить интернет", source_text="не забыть оплатить интернет")
    cls = FakeClassifier({task.source_text: Classification("expense", 0.97)})
    p, store, tg = make(ctx, FakeExtractor([task]), cls)
    p.process(row())
    assert store.inserted == []
    _, status, result, _, _ = store.finished[-1]
    assert status == "needs_review"
    assert result["pending_review"][0]["laya"] == {"group": "expense", "confidence": 0.97}
    assert tg.edited[0][2] == "❓ Уточни 1 — ниже."
    assert "«не забыть оплатить интернет»" in tg.sent[0][1]


def test_foreign_currency_is_converted(ctx):
    sub = item(kind="expense", title="Подписка", source_text="подписка 22,4 доллара", amount=22.4, currency="usd")
    p, store, tg = make(ctx, FakeExtractor([sub]))
    p.process(row())
    table, r = store.inserted[0]
    assert r["amount_base"] == "264738.31" and r["currency_orig"] == "USD"
    assert "по курсу 11 818,67" in tg.edited[0][2]


def test_base_currency_named_explicitly_is_not_converted(ctx):
    cof = item(kind="expense", title="Кофе", source_text="кофе 40 000 сум", amount=40000, currency="UZS")
    p, store, _ = make(ctx, FakeExtractor([cof]))
    p.process(row())
    assert store.inserted[0][1]["amount_base"] == "40000.00"
    assert "currency_orig" not in store.inserted[0][1]


def test_missing_rates_fetches_and_saves(ctx):
    store = FakeStore(ctx, rates=None)
    sub = item(kind="expense", title="Подписка", source_text="s", amount=1, currency="USD")
    p, store, _ = make(ctx, FakeExtractor([sub]), store=store)
    p.process(row())
    assert store.saved_rates == [RATES]
    assert store.inserted[0][1]["currency_orig"] == "USD"


def test_rates_unavailable_sends_to_review(ctx):
    def boom():
        raise FxError("сеть недоступна")

    store = FakeStore(ctx, rates=None)
    sub = item(kind="expense", title="Подписка", source_text="s", amount=1, currency="USD")
    p, store, _ = make(ctx, FakeExtractor([sub]), store=store, fetch=boom)
    p.process(row())
    assert store.finished[-1][1] == "needs_review"
    assert "курс" in store.finished[-1][2]["pending_review"][0]["reason"]


def test_validation_error_triggers_reextract_with_feedback(ctx):
    bad = item(kind="event", title="Созвон", source_text="созвон в пн (2026-10-05) в 10 (10:00)")
    good = item(kind="event", title="Созвон", source_text="созвон в пн (2026-10-05) в 10 (10:00)", starts_at=datetime(2026, 10, 5, 10, 0))
    ex = FakeExtractor([bad], [good])
    p, store, _ = make(ctx, ex)
    p.process(row())
    assert "starts_at" in ex.calls[1]["feedback"][0]
    assert store.inserted[0][0] == "items"


def test_nothing_to_record(ctx):
    p, store, tg = make(ctx, FakeExtractor([]))
    p.process(row(text="привет"))
    assert store.inserted == []
    assert store.finished[-1][1] == "done"
    assert tg.edited[0][2].startswith("🤷")


def test_voice_empty_transcript_fails_without_retry(ctx):
    p, store, tg = make(ctx, FakeExtractor(), stt=FakeStt(""))
    p.process(row(source="voice", text=None, audio_ref="F1"))
    _, status, _, error, notified = store.finished[-1]
    assert (status, error, notified) == ("failed", "empty_transcript", True)
    assert "Не расслышал" in tg.edited[0][2]


def test_voice_transcript_is_extracted(ctx):
    ex = FakeExtractor([TAXI])
    p, store, _ = make(ctx, ex, stt=FakeStt("30 000 на такси"))
    p.process(row(source="voice", text=None, audio_ref="F1"))
    assert ex.calls[0]["text"] == "30 000 на такси"
    assert store.finished[-1][2]["text"] == "30 000 на такси"


def test_review_pass_saves_forced_kind(ctx):
    pending = [{"item": item(kind="habit_done", title="Кофе", source_text="кофе 40 000", amount=40000)
                .model_dump(mode="json"), "reason": "laya", "laya": None, "forced_kind": "expense"}]
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"text": "кофе 40 000", "pending_review": pending}))
    assert store.inserted[0][0] == "transactions"
    _, status, result, _, _ = store.finished[-1]
    assert status == "done" and result["pending_review"][0]["resolved"] is True
    assert "💸 Кофе — 40 000 сум" in tg.sent[0][1]


def test_review_pass_reextracts_when_forced_kind_invalid(ctx):
    pending = [{"item": item(kind="task", title="Созвон", source_text="созвон в пн в 10").model_dump(mode="json"),
                "reason": "laya", "laya": None, "forced_kind": "event"}]
    fixed = item(kind="event", title="Созвон", source_text="созвон в пн в 10", starts_at=datetime(2026, 10, 5, 10))
    ex = FakeExtractor([fixed])
    p, store, _ = make(ctx, ex)
    p.process(row(result={"pending_review": pending}))
    assert ex.calls[0]["hint_kind"] == "event"
    assert store.inserted[0][0] == "items"


def test_review_pass_drop_and_partial(ctx):
    pending = [
        {"item": item(kind="note", source_text="a").model_dump(mode="json"), "reason": "laya", "laya": None,
         "forced_kind": "drop"},
        {"item": item(kind="note", source_text="b").model_dump(mode="json"), "reason": "laya", "laya": None},
    ]
    p, store, _ = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": pending}))
    assert store.inserted == []
    assert store.finished[-1][1] == "needs_review"


def test_run_one_retries_then_fails(ctx):
    p, store, tg = make(ctx, FakeExtractor(RuntimeError("ollama down")))
    run_one(row(attempts=1), p, store, tg)
    assert store.finished[-1][1] == "pending"
    p2, store2, tg2 = make(ctx, FakeExtractor(RuntimeError("ollama down")))
    run_one(row(attempts=3), p2, store2, tg2)
    assert store2.finished[-1][1] == "failed" and store2.finished[-1][4] is True
    assert "Не получилось" in tg2.edited[0][2]


def test_run_one_extraction_error_fails_immediately(ctx):
    p, store, tg = make(ctx, FakeExtractor(ExtractionError("bad json")))
    run_one(row(attempts=1), p, store, tg)
    assert store.finished[-1][1] == "failed"
    assert "Переформулируй" in tg.edited[0][2]


def test_notify_failed(ctx):
    store = FakeStore(ctx)
    store.failed = [row(id="i9", reply_message_id=None)]
    tg = FakeTg()
    notify_failed(store, tg)
    assert "Не получилось" in tg.sent[0][1]
    assert store.notified == ["i9"]


def test_telegram_failure_after_done_does_not_raise(ctx):
    p, store, tg = make(ctx, FakeExtractor([TAXI]))

    def boom(*a, **k):
        raise RuntimeError("telegram down")

    tg.edit = boom
    p.process(row())
    assert store.finished[-1][1] == "done"
    assert len(store.inserted) == 1


def test_main_path_clears_records_before_insert(ctx):
    p, store, _ = make(ctx, FakeExtractor([TAXI]))
    p.process(row())
    assert store.cleared == ["i1"]
    assert store.events == ["clear", "insert"]


def _review_pending(kind_from, forced, text):
    return [{"item": item(kind=kind_from, title="Созвон", source_text=text).model_dump(mode="json"),
             "reason": "laya", "laya": None, "forced_kind": forced}]


def test_review_reextract_error_is_contained(ctx):
    p, store, tg = make(ctx, FakeExtractor(ExtractionError("bad json")))
    p.process(row(result={"pending_review": _review_pending("task", "event", "созвон")}))
    _, status, result, _, _ = store.finished[-1]
    assert status == "done"
    e = result["pending_review"][0]
    assert e["resolved"] is True and e["failed"] is True
    assert tg.edited == [] and "⚠️" in tg.sent[0][1]


def test_review_save_error_is_contained(ctx):
    p, store, tg = make(ctx, FakeExtractor())

    def boom(table, r):
        raise RuntimeError("db down")

    store.insert = boom
    pending = [{"item": item(kind="note", title="n", source_text="n").model_dump(mode="json"),
                "reason": "laya", "laya": None, "forced_kind": "note"}]
    p.process(row(result={"pending_review": pending}))
    e = store.finished[-1][2]["pending_review"][0]
    assert e["resolved"] is True and e["failed"] is True
    assert "⚠️" in tg.sent[0][1]


def test_fetch_rates_network_error_goes_to_review(ctx):
    import httpx

    def boom():
        raise httpx.ConnectError("no network")

    store = FakeStore(ctx, rates=None)
    sub = item(kind="expense", title="Подписка", source_text="s", amount=1, currency="USD")
    p, store, _ = make(ctx, FakeExtractor([sub]), store=store, fetch=boom)
    p.process(row())
    assert store.finished[-1][1] == "needs_review"
    assert "курс" in store.finished[-1][2]["pending_review"][0]["reason"]


def test_run_one_persists_pre_process_result(ctx):
    class FlakyStore(FakeStore):
        def finish(self, *a, **k):
            if not self.finished:
                self.finished.append(("boom",))
                raise RuntimeError("db hiccup")
            super().finish(*a, **k)

    store = FlakyStore(ctx)
    pending = [{"item": item(kind="note", title="n", source_text="n").model_dump(mode="json"),
                "reason": "laya", "laya": None, "forced_kind": "note"}]
    r = row(attempts=1, result={"pending_review": pending})
    p, store, tg = make(ctx, FakeExtractor(), store=store)
    run_one(r, p, store, tg)
    _, status, result, _, _ = store.finished[-1]
    assert status == "pending"
    assert "resolved" not in result["pending_review"][0]


def test_notify_failed_continues_after_reply_error(ctx):
    store = FakeStore(ctx)
    store.failed = [row(id="a", reply_message_id=None), row(id="b", reply_message_id=None)]

    class FlakyTg(FakeTg):
        def send(self, chat_id, text, buttons=None):
            if not self.sent and not getattr(self, "tried", False):
                self.tried = True
                raise RuntimeError("telegram down")
            return super().send(chat_id, text, buttons)

    tg = FlakyTg()
    notify_failed(store, tg)
    assert store.notified == ["b"]


def test_review_pass_failure_sends_instead_of_editing_summary(ctx):
    pending = [{"item": item(kind="note", title="n", source_text="n").model_dump(mode="json"),
                "reason": "laya", "laya": None, "forced_kind": "note"}]
    r = row(attempts=3, result={"pending_review": pending})
    p, store, tg = make(ctx, FakeExtractor(RuntimeError("x")), store=type("S", (FakeStore,), {
        "load_context": lambda self, *a: (_ for _ in ()).throw(RuntimeError("db down"))})(ctx))
    run_one(r, p, store, tg)
    assert tg.edited == []
    assert "Не получилось" in tg.sent[0][1]


def test_notify_failed_review_row_sends(ctx):
    store = FakeStore(ctx)
    store.failed = [row(id="i9", result={"pending_review": [{"x": 1}]})]
    tg = FakeTg()
    notify_failed(store, tg)
    assert tg.edited == [] and "Не получилось" in tg.sent[0][1]


def test_shortcut_summary_has_phone_prefix_and_is_sent_as_new_message(ctx):
    p, store, tg = make(ctx, FakeExtractor([TAXI]))
    p.process(row(source="shortcut", reply_message_id=None))
    assert tg.edited == []
    assert tg.sent[0][1].startswith("📲 ✅ Записал:")


def test_run_one_extraction_error_on_shortcut_row_is_prefixed_and_quotes_text(ctx):
    p, store, tg = make(ctx, FakeExtractor(ExtractionError("bad json")))
    run_one(row(source="shortcut", text="x" * 150, reply_message_id=None), p, store, tg)
    msg = tg.sent[0][1]
    assert msg.startswith("📲 😵 Не смог разобрать.")
    assert msg.endswith("\n«" + "x" * 100 + "…»")


def test_notify_failed_shortcut_row_is_prefixed_and_quotes_text(ctx):
    store = FakeStore(ctx)
    store.failed = [row(id="i9", source="shortcut", text="купить молоко", reply_message_id=None)]
    tg = FakeTg()
    notify_failed(store, tg)
    assert tg.sent[0][1] == "📲 😵 Не получилось разобрать запись. Попробуй отправить ещё раз.\n«купить молоко»"


NO_TIME = item(kind="event", title="Встреча с Амиром", source_text="завтра (2026-10-02) встреча с Амиром",
               starts_at=datetime(2026, 10, 2, 16, 24))


def test_event_with_date_but_no_time_asks_what_time(ctx):
    p, store, tg = make(ctx, FakeExtractor([NO_TIME], [NO_TIME]))
    p.process(row())
    assert store.inserted == []
    _, status, result, _, _ = store.finished[-1]
    assert status == "needs_review" and result["pending_review"][0]["reason"] == "time"
    assert tg.sent[0][1] == "🕐 Во сколько «Встреча с Амиром» 02.10?"
    assert tg.sent[0][2][0][2]["callback_data"] == "rt:i1:0:1500"


def test_review_pass_applies_forced_time(ctx):
    entry = {"item": NO_TIME.model_dump(mode="json"), "reason": "time", "laya": None,
             "forced_kind": "event", "forced_time": "15:00"}
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": [entry]}))
    table, r = store.inserted[0]
    assert (table, r["kind"], r["starts_at"]) == ("items", "event", "2026-10-02T10:00:00+00:00")
    assert store.finished[-1][1] == "done"


def test_review_pass_time_none_saves_task_on_that_day(ctx):
    entry = {"item": NO_TIME.model_dump(mode="json"), "reason": "time", "laya": None, "forced_kind": "task"}
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": [entry]}))
    table, r = store.inserted[0]
    assert (table, r["kind"], r["due_at"]) == ("items", "task", "2026-10-02T18:59:00+00:00")


class FakeAnswerer:
    def __init__(self, text="💸 Потрачено в октябре: 1 сум (1 операция)"):
        self.text = text
        self.calls = []

    def answer(self, text, ctx):
        self.calls.append(text)
        return self.text, {"intent": "spent"}


def make_q(ctx, answerer, stt=None):
    store = FakeStore(ctx)
    tg = FakeTg()
    p = Pipeline(store, tg, stt or FakeStt(""), FakeExtractor(), None, lambda: RATES, 0.7,
                 Path("/tmp/planner-test"), answerer=answerer)
    return p, store, tg


def test_question_is_answered_without_records(ctx):
    ans = FakeAnswerer()
    p, store, tg = make_q(ctx, ans)
    p.process(row(text="Сколько потратил в октябре"))
    assert ans.calls == ["Сколько потратил в октябре"]
    assert store.inserted == [] and store.cleared == []
    assert store.finished == [("i1", "done", {"text": "Сколько потратил в октябре", "question": {"intent": "spent"},
                                              "answered": True, "reply": ans.text}, None, False)]
    assert tg.edited == [(5, 77, ans.text, None)]


def test_voice_question_is_transcribed_first(ctx):
    ans = FakeAnswerer()
    p, _, tg = make_q(ctx, ans, stt=FakeStt("Когда встреча с Ахмедом?"))
    p.process(row(text=None, source="voice", audio_ref="f1"))
    assert ans.calls == ["Когда встреча с Ахмедом?"]


def test_shortcut_question_gets_prefix(ctx):
    p, _, tg = make_q(ctx, FakeAnswerer("ответ"))
    p.process(row(text="сколько потратил", source="shortcut"))
    assert tg.edited[0][2] == "📲 ответ"


def test_record_text_still_goes_to_extraction(ctx):
    ans = FakeAnswerer()
    p, store, tg = make(ctx, FakeExtractor([TAXI]))
    p.answerer = ans
    p.process(row(text="30 000 на такси"))
    assert ans.calls == []
    assert store.inserted[0][0] == "transactions"


def test_question_answer_telegram_failure_does_not_retry(ctx):
    p, store, tg = make_q(ctx, FakeAnswerer())

    def boom(*a, **kw):
        raise RuntimeError("telegram down")

    tg.edit = boom
    p.process(row(text="сколько потратил"))
    assert store.finished[0][1] == "done"


def test_unknown_question_falls_back_to_record(ctx):
    task = item(kind="task", title="Показать Ахмеду отчёт", source_text="Покажи Ахмеду отчёт завтра")
    store = FakeStore(ctx)
    tg = FakeTg()
    ans = FakeAnswerer()
    ans.answer = lambda text, ctx: None
    p = Pipeline(store, tg, FakeStt(""), FakeExtractor([task]), None, lambda: RATES, 0.7,
                 Path("/tmp/planner-test"), answerer=ans)
    p.process(row(text="Покажи Ахмеду отчёт завтра"))
    assert store.inserted[0][0] == "items"
    assert store.finished[-1][1] == "done"
    assert "question" not in store.finished[-1][2]


def test_done_result_keeps_reply(ctx):
    p, store, tg = make(ctx, FakeExtractor([TAXI]))
    p.process(row(text="30 000 на такси"))
    assert store.finished[-1][2]["reply"].startswith("✅ Записал:")


def test_miniapp_summary_gets_phone_prefix_in_chat_only(ctx):
    p, store, tg = make(ctx, FakeExtractor([TAXI]))
    p.process(row(text="30 000 на такси", source="miniapp", reply_message_id=None))
    assert tg.sent[0][1].startswith("📱 ✅ Записал:")
    assert store.finished[-1][2]["reply"].startswith("✅ Записал:")


def test_empty_transcript_reply_is_stored(ctx):
    p, store, tg = make(ctx, FakeExtractor(), stt=FakeStt(""))
    p.process(row(text=None, source="voice", audio_ref="f1"))
    assert store.finished[-1][2] == {"text": "", "reply": "🙉 Не расслышал. Повтори, пожалуйста."}


def test_miniapp_error_reply_has_prefix_and_quote(ctx):
    p, store, tg = make(ctx, FakeExtractor(ExtractionError("bad json")))
    r = row(text="абракадабра", source="miniapp", reply_message_id=None)
    run_one(r, p, store, tg)
    assert tg.sent[0][1].startswith("📱 😵") and "«абракадабра»" in tg.sent[0][1]


class AudioStore(FakeStore):
    def __init__(self, ctx):
        super().__init__(ctx)
        self.downloaded, self.texts, self.removed = [], [], []

    def download_audio(self, key, dest_dir):
        self.downloaded.append(key)
        return dest_dir / Path(key).name

    def set_text(self, inbox_id, text):
        self.texts.append((inbox_id, text))

    def remove_audio(self, key):
        self.removed.append(key)


def audio_row(**kw):
    return row(**{"text": None, "source": "miniapp", "audio_ref": "storage:u1/a.m4a", "reply_message_id": None, **kw})


def test_storage_audio_is_transcribed_saved_and_removed(ctx):
    store = AudioStore(ctx)
    p, _, tg = make(ctx, FakeExtractor([TAXI]), stt=FakeStt("30 000 на такси"), store=store)

    def no_tg_download(*a):
        raise AssertionError("telegram download must not be used")

    tg.download = no_tg_download
    p.process(audio_row())
    assert store.downloaded == ["u1/a.m4a"]
    assert store.texts == [("i1", "30 000 на такси")]
    assert store.removed == ["u1/a.m4a"]
    assert store.inserted[0][0] == "transactions"


def test_final_failure_removes_storage_audio(ctx):
    store = AudioStore(ctx)
    p, _, tg = make(ctx, FakeExtractor(RuntimeError("ollama down")), stt=FakeStt("кофе"), store=store)
    store.removed.clear()

    def boom(*a):
        raise RuntimeError("stt crashed")

    p.stt.transcribe = boom
    run_one(audio_row(attempts=3), p, store, tg)
    assert store.finished[-1][1] == "failed"
    assert store.removed == ["u1/a.m4a"]


def test_retry_keeps_storage_audio(ctx):
    store = AudioStore(ctx)
    p, _, tg = make(ctx, FakeExtractor(), stt=FakeStt("кофе"), store=store)

    def boom(*a):
        raise RuntimeError("stt crashed")

    p.stt.transcribe = boom
    run_one(audio_row(attempts=1), p, store, tg)
    assert store.finished[-1][1] == "pending"
    assert store.removed == []


PAST = item(kind="event", title="Встреча с Амиром", source_text="Встреча с Амиром 04:30",
            starts_at=datetime(2026, 10, 1, 4, 30))


def test_event_earlier_today_asks_instead_of_saving(ctx):
    p, store, tg = make(ctx, FakeExtractor([PAST]))
    p.process(row(text="Встреча с Амиром 04:30"))
    assert store.inserted == []
    _, status, result, _, _ = store.finished[-1]
    assert status == "needs_review" and result["pending_review"][0]["reason"] == "past"
    assert tg.sent[0][1] == "🕐 04:30 уже прошло. Когда «Встреча с Амиром»?"


def test_event_a_few_minutes_ago_is_saved(ctx):
    just = item(kind="event", title="Созвон", source_text="созвон 09:50", starts_at=datetime(2026, 10, 1, 9, 50))
    p, store, tg = make(ctx, FakeExtractor([just]))
    p.process(row(text="созвон 09:50"))
    assert store.inserted[0][0] == "items"


def test_event_on_an_explicit_past_day_is_saved(ctx):
    yday = item(kind="event", title="Встреча", source_text="вчера (2026-09-30) в 15:00 (15:00) встреча",
                starts_at=datetime(2026, 9, 30, 15, 0))
    p, store, tg = make(ctx, FakeExtractor([yday]))
    p.process(row(text="вчера в 15:00 встреча"))
    assert store.inserted[0][0] == "items"


def _past_pending(**extra):
    return [{"item": PAST.model_dump(mode="json"), "reason": "past", "laya": None, **extra}]


def test_past_choice_tomorrow_moves_to_next_day(ctx):
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": _past_pending(forced_kind="event", forced_time="04:30")}))
    assert store.inserted[0][1]["starts_at"] == "2026-10-01T23:30:00+00:00"  # 02.10 04:30 Ташкент


def test_past_choice_today_pm(ctx):
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": _past_pending(forced_kind="event", forced_time="16:30")}))
    assert store.inserted[0][1]["starts_at"] == "2026-10-01T11:30:00+00:00"  # 01.10 16:30 Ташкент


def test_past_choice_keep_saves_as_is(ctx):
    p, store, tg = make(ctx, FakeExtractor())
    p.process(row(result={"pending_review": _past_pending(forced_kind="event")}))
    assert store.inserted[0][1]["starts_at"] == "2026-09-30T23:30:00+00:00"  # 01.10 04:30 Ташкент


FUTURE_TAXI = item(kind="expense", title="Такси", source_text="10.10 (2026-10-10) такси 30 000", amount=30000,
                   occurred_on=date(2026, 10, 10))


def test_future_money_asks_instead_of_saving(ctx):
    p, store, tg = make(ctx, FakeExtractor([FUTURE_TAXI], [FUTURE_TAXI]))
    p.process(row(text="10.10 такси 30 000"))
    assert store.inserted == []
    _, status, result, _, _ = store.finished[-1]
    assert status == "needs_review" and result["pending_review"][0]["reason"] == "future"
    text, buttons = tg.sent[0][1], tg.sent[0][2]
    assert text == "📅 10.10 ещё не наступило. Записать «Такси» на сегодня?"
    assert buttons == [[{"text": "На сегодня", "callback_data": "rv:i1:0:expense"},
                        {"text": "🗑 Пропустить", "callback_data": "rv:i1:0:drop"}]]


def test_future_money_choice_saves_today(ctx):
    p, store, tg = make(ctx, FakeExtractor())
    pending = [{"item": FUTURE_TAXI.model_dump(mode="json"), "reason": "future", "laya": None, "forced_kind": "expense"}]
    p.process(row(result={"pending_review": pending}))
    assert store.inserted[0][0] == "transactions"
    assert store.inserted[0][1]["occurred_at"] == "2026-10-01"
