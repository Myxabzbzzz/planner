import json

import httpx
import pytest

from planner_worker.llm import ExtractionError, Extractor, OllamaClient
from planner_worker.prompts import EXTRACTION_SCHEMA, build_extract_messages


class ScriptedLLM:
    def __init__(self, replies: list[str]):
        self.replies = replies
        self.calls: list[list[dict]] = []

    def chat_json(self, messages, schema):
        self.calls.append(messages)
        return self.replies.pop(0)


GOOD = json.dumps({"items": [{"kind": "expense", "title": "Кофе", "source_text": "кофе 40 000", "amount": 40000}]})


def test_messages_contain_context(ctx):
    msgs = build_extract_messages("кофе 40 000", ctx)
    user = msgs[1]["content"]
    assert msgs[0]["role"] == "system"
    assert "2026-10-01T10:00 (четверг)" in user
    assert "Базовая валюта: UZS" in user
    assert "зарядка, чтение" in user
    assert user.endswith("кофе 40 000")


def test_messages_include_hint_and_feedback(ctx):
    user = build_extract_messages("x", ctx, hint_kind="event", feedback=["у встречи (event) нет starts_at"])[1]["content"]
    assert "типа event" in user
    assert "нет starts_at" in user


def test_extract_parses_items(ctx):
    items = Extractor(ScriptedLLM([GOOD])).extract("кофе 40 000", ctx)
    assert items[0].kind == "expense"
    assert items[0].amount == 40000


def test_extract_retries_on_bad_json(ctx):
    llm = ScriptedLLM(['{"items": [{"kind": "bogus"}]}', GOOD])
    items = Extractor(llm).extract("кофе 40 000", ctx)
    assert len(items) == 1
    assert len(llm.calls) == 2
    assert "не прошёл проверку схемы" in llm.calls[1][-1]["content"]


def test_extract_gives_up_after_two_failures(ctx):
    with pytest.raises(ExtractionError):
        Extractor(ScriptedLLM(["nope", "still nope"])).extract("x", ctx)


def test_ollama_client_request_shape():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen.update(json.loads(req.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": GOOD}})

    client = OllamaClient("http://ollama", "qwen3:8b", httpx.Client(transport=httpx.MockTransport(handler)))
    out = client.chat_json([{"role": "user", "content": "hi"}], EXTRACTION_SCHEMA)
    assert out == GOOD
    assert seen["model"] == "qwen3:8b"
    assert seen["stream"] is False
    assert seen["think"] is False
    assert seen["options"]["temperature"] == 0
    assert seen["format"] == EXTRACTION_SCHEMA


def test_messages_contain_calendar(ctx):
    import re

    user = build_extract_messages("x", ctx)[1]["content"]
    line = next(l for l in user.splitlines() if l.startswith("Календарь:"))
    assert "сегодня чт 2026-10-01" in line
    assert "завтра пт 2026-10-02" in line
    assert "пн 2026-10-05" in line
    assert len(re.findall(r"\d{4}-\d{2}-\d{2}", line)) == 14


def test_annotate_dates():
    from datetime import date

    from planner_worker.prompts import annotate_dates

    t = date(2026, 10, 1)
    assert "пятницы (2026-10-02)" in annotate_dates("до пятницы сдать отчёт", t)
    assert "понедельник (2026-10-05)" in annotate_dates("в понедельник в 10", t)
    out = annotate_dates("послезавтра в 19:30", t)
    assert "послезавтра (2026-10-03)" in out and "завтра (2026-10-02)" not in out
    assert "(2026-10-01)" in annotate_dates("в четверг", t)
    assert "(2026-10-03)" in annotate_dates("в субботу", t)
    assert "завтра (2026-10-02)" in annotate_dates("Завтра в 3", t) or "Завтра (2026-10-02)" in annotate_dates("Завтра в 3", t)
    for s in ["до пятницы, завтра и в субботу", "послезавтра"]:
        once = annotate_dates(s, t)
        assert annotate_dates(once, t) == once
    assert annotate_dates("кофе 40 000", t) == "кофе 40 000"


def test_message_text_is_annotated(ctx):
    user = build_extract_messages("в субботу футбол", ctx)[1]["content"]
    assert user.endswith("в субботу (2026-10-03) футбол")


def test_annotate_times():
    from planner_worker.prompts import annotate_times
    assert annotate_times("встреча со славиком в час") == "встреча со славиком в час (13:00)"
    assert annotate_times("встреча в 3") == "встреча в 3 (15:00)"
    assert annotate_times("созвон в 10") == "созвон в 10 (10:00)"
    assert annotate_times("ужин в 19:30") == "ужин в 19:30 (19:30)"
    assert annotate_times("в 9 утра зал") == "в 9 утра (09:00) зал"
    assert annotate_times("в 7 вечера кино") == "в 7 вечера (19:00) кино"
    assert annotate_times("к 9 отвезти машину") == "к 9 (09:00) отвезти машину"
    assert annotate_times("обед в полдень") == "обед в полдень (12:00)"
    assert annotate_times("в 3 часа созвон") == "в 3 часа (15:00) созвон"
    assert annotate_times("в 12 ночи") == "в 12 ночи (00:00)"
    assert annotate_times("потратил 200$ на кофе") == "потратил 200$ на кофе"
    assert annotate_times("в 2026 году") == "в 2026 году"
    once = annotate_times("Встреча в час")
    assert once == "Встреча в час (13:00)"
    assert annotate_times(once) == once


def test_messages_annotate_times(ctx):
    user = build_extract_messages("встреча со славиком в час", ctx)[1]["content"]
    assert user.endswith("встреча со славиком в час (13:00)")


def test_annotate_times_half_hours():
    from planner_worker.prompts import annotate_times
    assert annotate_times("встреча с Амиром в полвторого") == "встреча с Амиром в полвторого (13:30)"
    assert annotate_times("обед в полпервого") == "обед в полпервого (12:30)"
    assert annotate_times("к полдесятого") == "к полдесятого (09:30)"
    assert annotate_times("в полчетвёртого") == "в полчетвёртого (15:30)"


def test_system_prompt_has_no_copyable_expense_example():
    from planner_worker.prompts import SYSTEM
    assert "Ерунда" not in SYSTEM
    assert "«Трата»" in SYSTEM
