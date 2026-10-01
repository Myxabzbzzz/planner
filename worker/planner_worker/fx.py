from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

import httpx

ER_API_URL = "https://open.er-api.com/v6/latest/USD"
CENT = Decimal("0.01")
RATE_Q = Decimal("0.00000001")


@dataclass(frozen=True)
class RateTable:
    date: date
    rates: dict[str, Decimal]  # единиц валюты за 1 USD
    source: str


@dataclass(frozen=True)
class FxApplied:
    amount_base: Decimal
    amount_orig: Decimal
    currency_orig: str
    rate: Decimal  # единиц базовой валюты за 1 единицу исходной
    rate_date: date
    source: str


class FxError(Exception):
    pass


def convert(amount: Decimal, frm: str, to: str, table: RateTable) -> FxApplied:
    try:
        r_from, r_to = table.rates[frm], table.rates[to]
    except KeyError as e:
        raise FxError(f"нет курса для {e.args[0]}") from None
    rate = (r_to / r_from).quantize(RATE_Q, ROUND_HALF_UP)
    amount_base = (amount * r_to / r_from).quantize(CENT, ROUND_HALF_UP)
    return FxApplied(amount_base, amount, frm, rate, table.date, table.source)


def parse_er_api(payload: dict) -> RateTable:
    if payload.get("result") != "success" or payload.get("base_code") != "USD":
        raise FxError("плохой ответ open.er-api.com")
    d = datetime.fromtimestamp(payload["time_last_update_unix"], tz=timezone.utc).date()
    rates = {k: Decimal(str(v)) for k, v in payload["rates"].items()}
    return RateTable(d, rates, "open.er-api.com")


def fetch_latest(http: httpx.Client) -> RateTable:
    r = http.get(ER_API_URL, timeout=10)
    r.raise_for_status()
    return parse_er_api(r.json())
