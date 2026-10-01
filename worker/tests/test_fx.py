from datetime import date
from decimal import Decimal

import httpx
import pytest

from planner_worker.fx import FxError, RateTable, convert, fetch_latest, parse_er_api

TABLE = RateTable(date(2026, 10, 1), {"USD": Decimal("1"), "UZS": Decimal("11818.674758"),
                                       "RUB": Decimal("83.691177")}, "open.er-api.com")


def test_usd_to_uzs():
    fx = convert(Decimal("22.4"), "USD", "UZS", TABLE)
    assert fx.amount_base == Decimal("264738.31")
    assert fx.rate == Decimal("11818.67475800")
    assert fx.amount_orig == Decimal("22.4")
    assert fx.currency_orig == "USD"
    assert fx.rate_date == date(2026, 10, 1)


def test_cross_rate_via_usd():
    fx = convert(Decimal("1000"), "RUB", "UZS", TABLE)
    assert fx.amount_base == Decimal("141217.69")
    assert fx.rate == Decimal("141.21769082")


def test_missing_currency_raises():
    with pytest.raises(FxError, match="GBP"):
        convert(Decimal("1"), "GBP", "UZS", TABLE)


def test_parse_er_api():
    t = parse_er_api({"result": "success", "base_code": "USD", "time_last_update_unix": 1790812951,
                      "rates": {"USD": 1, "UZS": 11818.674758}})
    assert t.date == date(2026, 10, 1)
    assert t.rates["UZS"] == Decimal("11818.674758")


def test_parse_er_api_rejects_error():
    with pytest.raises(FxError):
        parse_er_api({"result": "error"})


def test_fetch_latest_uses_http():
    def handler(req: httpx.Request) -> httpx.Response:
        assert str(req.url) == "https://open.er-api.com/v6/latest/USD"
        return httpx.Response(200, json={"result": "success", "base_code": "USD",
                                         "time_last_update_unix": 1790812951, "rates": {"USD": 1}})
    t = fetch_latest(httpx.Client(transport=httpx.MockTransport(handler)))
    assert t.source == "open.er-api.com"
