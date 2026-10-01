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
