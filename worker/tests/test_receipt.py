import json
from datetime import date

import httpx

from planner_worker.receipt import Receipt, ReceiptReader, compose, merchant_name

TODAY = date(2026, 10, 15)


def reader(answer: dict | str, seen: dict | None = None):
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.update(json.loads(req.content))
        content = answer if isinstance(answer, str) else json.dumps(answer)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}})
    return ReceiptReader("http://ollama", "qwen2.5vl:7b", httpx.Client(transport=httpx.MockTransport(handler)))


def test_reads_the_receipt_and_sends_the_image(tmp_path):
    img = tmp_path / "r.jpg"
    img.write_bytes(b"\xff\xd8jpeg")
    seen: dict = {}
    got = reader({"is_receipt": True, "merchant": "Пятёрочка", "total": 1234.5, "currency": "RUB", "date": "2026-10-14"},
                 seen).read(img)
    assert got == Receipt(is_receipt=True, merchant="Пятёрочка", total=1234.5, currency="RUB", date="2026-10-14")
    assert seen["model"] == "qwen2.5vl:7b"
    assert seen["messages"][0]["images"] == ["/9hqcGVn"]
    assert seen["keep_alive"] == "1m"


def test_not_a_receipt_or_no_total_is_none(tmp_path):
    img = tmp_path / "r.jpg"
    img.write_bytes(b"x")
    assert reader({"is_receipt": False}).read(img) is None
    assert reader({"is_receipt": True, "merchant": "Кафе", "total": None}).read(img) is None
    assert reader("не JSON").read(img) is None


def test_compose_makes_an_ordinary_expense_phrase():
    rc = Receipt(is_receipt=True, merchant="Пятёрочка", total=1234.5, currency="rub", date="2026-10-14")
    assert compose(rc, None, TODAY) == "14.10.2026 потратил 1234.5 (валюта RUB) в «Пятёрочка»"
    assert compose(rc, "продукты домой", TODAY) == "14.10.2026 потратил 1234.5 (валюта RUB) на продукты домой"


def test_compose_drops_an_implausible_date_reads_currency_signs():
    rc = Receipt(is_receipt=True, merchant="Кафе", total=900.0, currency="руб.", date="2031-01-01")
    assert compose(rc.model_copy(update={"currency": "денег"}), None, TODAY) == "потратил 900 в «Кафе»"
    assert compose(rc, None, TODAY) == "потратил 900 (валюта RUB) в «Кафе»"


def test_compose_reads_dotted_dates_and_names_a_nameless_receipt():
    rc = Receipt(is_receipt=True, merchant=None, total=823.55, currency="₽", date="14.10.2026")
    assert compose(rc, None, TODAY) == "14.10.2026 потратил 823.55 (валюта RUB) по чеку"


def test_merchant_name_keeps_the_sign_not_the_paperwork():
    assert merchant_name('Магазин "Пятёрочка" №1123') == "Пятёрочка"
    assert merchant_name("ООО «Ромашка»") == "Ромашка"
    assert merchant_name("Шоколадница") == "Шоколадница"
    assert merchant_name("ООО «АГРОТОРГ» Магазин «Пятёрочка» №1123") == "Пятёрочка"
    assert merchant_name("Магазин Магнит №55") == "Магнит"
    assert merchant_name("  ") is None
