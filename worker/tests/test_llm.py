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


def test_annotate_relative_dates():
    from datetime import date
    from planner_worker.prompts import annotate_dates
    d = date(2026, 10, 3)
    assert annotate_dates("через две недели встреча", d) == "через две недели (2026-10-17) встреча"
    assert annotate_dates("через неделю", d) == "через неделю (2026-10-10)"
    assert annotate_dates("через 3 дня", d) == "через 3 дня (2026-10-06)"
    assert annotate_dates("через пару дней", d) == "через пару дней (2026-10-05)"
    assert annotate_dates("через месяц", d) == "через месяц (2026-11-03)"
    assert annotate_dates("через два месяца", d) == "через два месяца (2026-12-03)"
    once = annotate_dates("через неделю", d)
    assert annotate_dates(once, d) == once


def test_annotate_times_without_preposition():
    from planner_worker.prompts import annotate_times
    assert annotate_times("через две недели час дня встреча") == "через две недели час дня (13:00) встреча"
    assert annotate_times("в 3 часа дня") == "в 3 часа дня (15:00)"
    assert annotate_times("созвон 5 вечера") == "созвон 5 вечера (17:00)"
    assert annotate_times("в 2 часа ночи") == "в 2 часа ночи (02:00)"
    assert annotate_times("час ночи") == "час ночи (01:00)"
    assert annotate_times("в 5 вечера") == "в 5 вечера (17:00)"


def test_system_prompt_title_and_category_hints():
    from planner_worker.prompts import SYSTEM
    assert "«Claude»" in SYSTEM and "«Продажа футболки»" in SYSTEM
    assert "подписки" in SYSTEM


def test_system_prompt_money_direction_rule():
    from planner_worker.prompts import SYSTEM
    assert "скинул" in SYSTEM and "expense с title «Маме»" in SYSTEM


def test_annotate_in_minutes_and_hours():
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from planner_worker.prompts import annotate_in_time
    now = datetime(2026, 10, 3, 19, 15, 40, tzinfo=ZoneInfo("Asia/Tashkent"))
    assert annotate_in_time("встреча с MacBook через 35 минут", now) == "встреча с MacBook через 35 минут (2026-10-03) (19:50)"
    assert annotate_in_time("через 2 часа созвон", now) == "через 2 часа (2026-10-03) (21:15) созвон"
    assert annotate_in_time("через час", now) == "через час (2026-10-03) (20:15)"
    assert annotate_in_time("через полчаса", now) == "через полчаса (2026-10-03) (19:45)"
    assert annotate_in_time("через полтора часа", now) == "через полтора часа (2026-10-03) (20:45)"
    assert annotate_in_time("через пять часов", now) == "через пять часов (2026-10-04) (00:15)"
    assert annotate_in_time("через 10 мин", now) == "через 10 мин (2026-10-03) (19:25)"
    assert annotate_in_time("через неделю", now) == "через неделю"
    once = annotate_in_time("через 35 минут", now)
    assert annotate_in_time(once, now) == once


def test_annotate_explicit_dates():
    from datetime import date
    from planner_worker.prompts import annotate_dates
    d = date(2026, 10, 3)
    assert annotate_dates("поездка 11.10", d) == "поездка 11.10 (2026-10-11)"
    assert annotate_dates("сдать до 05.01", d) == "сдать до 05.01 (2027-01-05)"
    assert annotate_dates("потратил 28.09 на такси", d) == "потратил 28.09 (2026-09-28) на такси"
    assert annotate_dates("встреча 1.11.2026", d) == "встреча 1.11.2026 (2026-11-01)"
    assert annotate_dates("день рождения 15 октября", d) == "день рождения 15 октября (2026-10-15)"
    assert annotate_dates("в 12.30 обед", d) == "в 12.30 обед"
    assert annotate_dates("потратил 10.50 $", d) == "потратил 10.50 $"
    assert annotate_dates("потратил 12.10 долларов", d) == "потратил 12.10 долларов"
    assert annotate_dates("31.02 что-то", d) == "31.02 что-то"
    once = annotate_dates("поездка 11.10", d)
    assert annotate_dates(once, d) == once


def test_explicit_date_beats_weekday():
    from datetime import date
    from planner_worker.prompts import annotate_dates
    d = date(2026, 10, 3)
    out = annotate_dates("Надо решить на счет поездки в воскресенье следующее 11.10", d)
    assert out == "Надо решить на счет поездки в воскресенье следующее 11.10 (2026-10-11)"
    assert annotate_dates("в воскресенье футбол", d) == "в воскресенье (2026-10-04) футбол"


def test_split_number_lists():
    from planner_worker.prompts import split_number_lists
    assert split_number_lists("Сегодня 290 ,60 и 70 потратил и еще 100") == "Сегодня 290 и 60 и 70 потратил и еще 100"
    assert split_number_lists("потратил 200, 300") == "потратил 200 и 300"
    assert split_number_lists("200 000, 50 000 на такси") == "200 000 и 50 000 на такси"
    assert split_number_lists("подписка 22,4 доллара") == "подписка 22,4 доллара"


def test_messages_apply_new_annotations(ctx):
    import re
    user = build_extract_messages("Сегодня 290 ,60 потратил", ctx)[1]["content"]
    assert "290 и 60" in user
    user = build_extract_messages("созвон через 30 минут", ctx)[1]["content"]
    assert re.search(r"через 30 минут \(\d{4}-\d{2}-\d{2}\) \(\d{2}:\d{2}\)", user)


def test_split_comma_chains():
    from planner_worker.prompts import split_number_lists
    assert split_number_lists("Я потратил 290,60,80.") == "Я потратил 290 и 60 и 80."
    assert split_number_lists("50,30,20 и 10") == "50 и 30 и 20 и 10"
    assert split_number_lists("курс 1,5") == "курс 1,5"


def test_numbers_only_hint(ctx):
    assert "только из чисел" in build_extract_messages("50 80", ctx)[1]["content"]
    assert "только из чисел" not in build_extract_messages("кофе 40 000", ctx)[1]["content"]


def test_annotate_amounts():
    from planner_worker.prompts import annotate_amounts
    assert annotate_amounts("25 тыщ кофе") == "25 тыщ (25000) кофе"
    assert annotate_amounts("потратил 25 тысяч на такси") == "потратил 25 тысяч (25000) на такси"
    assert annotate_amounts("кофе 40 тыс.") == "кофе 40 тыс. (40000)"
    assert annotate_amounts("2 тыщи на хлеб") == "2 тыщи (2000) на хлеб"
    assert annotate_amounts("1 тысяча") == "1 тысяча (1000)"
    assert annotate_amounts("такси 30к") == "такси 30к (30000)"
    assert annotate_amounts("такси 30 к") == "такси 30 к (30000)"
    assert annotate_amounts("1,5 млн за ноутбук") == "1,5 млн (1500000) за ноутбук"
    assert annotate_amounts("2 миллиона") == "2 миллиона (2000000)"
    assert annotate_amounts("полторы тысячи на кофе") == "полторы тысячи (1500) на кофе"
    assert annotate_amounts("20 тысяч долларов") == "20 тысяч (20000) долларов"


def test_annotate_amounts_leaves_other_text():
    from planner_worker.prompts import annotate_amounts
    for s in ["кофе 40 000", "к 9 отвезти машину", "в 3 к врачу", "пришло 200 к", "тысяча вопросов"]:
        expected = "пришло 200 к (200000)" if s == "пришло 200 к" else s
        assert annotate_amounts(s) == expected
    once = annotate_amounts("25 тыщ кофе")
    assert annotate_amounts(once) == once


def test_messages_annotate_amounts(ctx):
    assert build_extract_messages("25 тыщ кофе", ctx)[1]["content"].endswith("25 тыщ (25000) кофе")


def test_join_thousand_dots():
    from planner_worker.prompts import join_thousand_dots
    assert join_thousand_dots("расходы 150.000 и 60.000,50.000") == "расходы 150000 и 60000,50000"
    assert join_thousand_dots("1.250.000 сум") == "1250000 сум"
    for s in ["кофе 22.40", "в 10.30 встреча", "11.10 стоматолог", "11.10.2026", "курс 1.5"]:
        assert join_thousand_dots(s) == s


def test_annotate_dates_past():
    from datetime import date

    from planner_worker.prompts import annotate_dates
    t = date(2026, 10, 7)
    assert annotate_dates("за вчера расходы", t) == "за вчера (2026-10-06) расходы"
    assert annotate_dates("позавчера такси", t) == "позавчера (2026-10-05) такси"


def test_messages_dotted_amount_list(ctx):
    user = build_extract_messages("Шушара добавь за вчера расходы 150.000 и 60.000,50.000,70.000,30.000", ctx)[1]["content"]
    assert "вчера (2026-09-30) расходы 150000 и 60000 и 50000 и 70000 и 30000" in user


def test_prompt_explains_occurred_on():
    from planner_worker.prompts import SYSTEM
    assert "occurred_on" in SYSTEM


def test_annotate_dates_ago_and_last_week():
    from datetime import date

    from planner_worker.prompts import annotate_dates
    t = date(2026, 10, 1)  # четверг
    assert annotate_dates("3 дня назад такси", t) == "3 дня назад (2026-09-28) такси"
    assert annotate_dates("два дня назад обед", t) == "два дня назад (2026-09-29) обед"
    assert annotate_dates("неделю назад кино", t) == "неделю назад (2026-09-24) кино"
    assert annotate_dates("месяц назад ремонт", t) == "месяц назад (2026-09-01) ремонт"
    assert annotate_dates("на прошлой неделе продукты", t) == "на прошлой неделе (2026-09-21) продукты"
    once = annotate_dates("3 дня назад такси", t)
    assert annotate_dates(once, t) == once


def test_annotate_dates_last_weekday():
    from datetime import date

    from planner_worker.prompts import annotate_dates
    t = date(2026, 10, 1)  # четверг
    assert annotate_dates("в прошлый понедельник такси", t) == "в прошлый понедельник (2026-09-28) такси"
    assert annotate_dates("в прошлую среду обед", t) == "в прошлую среду (2026-09-30) обед"
    assert annotate_dates("в прошлый четверг кино", t) == "в прошлый четверг (2026-09-24) кино"
    assert annotate_dates("в понедельник созвон", t) == "в понедельник (2026-10-05) созвон"


def test_annotate_times_skips_day_counts():
    from planner_worker.prompts import annotate_times
    for s in ["3 дня назад (2026-09-28) такси", "через 3 дня (2026-10-04) сдать", "за 3 дня потратил 500", "на 3 дня в Самарканд"]:
        assert annotate_times(s) == s
    assert annotate_times("в 3 дня встреча") == "в 3 дня (15:00) встреча"
