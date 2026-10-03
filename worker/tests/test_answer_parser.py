import json

import pytest
from pydantic import ValidationError

from planner_worker.answer import QuestionParser
from planner_worker.prompts import build_question_messages
from planner_worker.schemas import Question


class ScriptedLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def chat_json(self, messages, schema):
        self.calls.append(messages)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def q(**kw):
    return json.dumps({"intent": "spent", "category": None, "period": None, "period2": None, "query": None, **kw})


def test_messages_contain_context(ctx):
    msgs = build_question_messages("сколько потратил на такси?", ctx)
    user = msgs[1]["content"]
    assert msgs[0]["role"] == "system"
    assert "2026-10-01 (четверг)" in user
    assert "такси/транспорт" in user
    assert "зарплата" in user
    assert user.endswith("сколько потратил на такси?")


def test_parse_valid(ctx):
    llm = ScriptedLLM([q(category="такси/транспорт", period="month:2026-09")])
    got = QuestionParser(llm).parse("x", ctx)
    assert (got.intent, got.category, got.period) == ("spent", "такси/транспорт", "month:2026-09")


def test_parse_retries_with_feedback(ctx):
    llm = ScriptedLLM([q(period="someday"), q(period="last_month")])
    got = QuestionParser(llm).parse("x", ctx)
    assert got.period == "last_month"
    assert len(llm.calls) == 2
    assert "не прошёл проверку" in llm.calls[1][-1]["content"]


def test_parse_gives_unknown_after_two_failures(ctx):
    llm = ScriptedLLM(["not json", q(intent="find_event", query="")])
    assert QuestionParser(llm).parse("x", ctx).intent == "unknown"


def test_network_error_propagates(ctx):
    llm = ScriptedLLM([ConnectionError("down")])
    with pytest.raises(ConnectionError):
        QuestionParser(llm).parse("x", ctx)


@pytest.mark.parametrize("period", ["today", "next_7_days", "all_time", "month:2026-01", "month:2025-12"])
def test_period_codes_valid(period):
    assert Question(intent="spent", period=period).period == period


@pytest.mark.parametrize("period", ["month:2026-13", "month:2026-00", "month:26-09", "сегодня", "week"])
def test_period_codes_invalid(period):
    with pytest.raises(ValidationError):
        Question(intent="spent", period=period)


def test_find_event_requires_query():
    with pytest.raises(ValidationError):
        Question(intent="find_event", query="  ")
    assert Question(intent="find_event", query="Ахмед").query == "Ахмед"


def test_today_without_the_word_is_dropped(ctx):
    llm = ScriptedLLM([q(intent="top_categories", period="today")])
    assert QuestionParser(llm).parse("На что больше всего трачу", ctx).period is None


def test_today_with_the_word_is_kept(ctx):
    llm = ScriptedLLM([q(intent="agenda", period="today"), q(intent="spent", period2="today", period="yesterday")])
    assert QuestionParser(llm).parse("Что у меня на СЕГОДНЯ?", ctx).period == "today"
    assert QuestionParser(llm).parse("сравни вчера и сегодня", ctx).period2 == "today"
