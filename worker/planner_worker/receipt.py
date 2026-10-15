"""Фото чека → трата (Pro).

Модель, понимающая картинки, достаёт из чека магазин, итог, валюту и дату — строго по схеме.
Из этого собирается обычная фраза («14.10.2026 потратил 1234.5 (валюта RUB) в «Пятёрочке»»),
и дальше чек идёт тем же путём, что голос и текст: категория, курс, подтверждение в чат.
Свои суммы модель не складывает: берём только напечатанный итог.
"""
import base64
import re
from datetime import date
from pathlib import Path

import httpx
from pydantic import BaseModel, ValidationError

PROMPT = (
    "Это фото кассового чека или скриншот оплаты. Верни JSON с полями:\n"
    '{"is_receipt": true, "merchant": "…", "total": 0.0, "currency": null, "date": null}\n'
    "merchant — название магазина, кафе или получателя с чека (обычно в верхних строках).\n"
    "total — итоговая сумма к оплате (строка ИТОГ, ИТОГО, К ОПЛАТЕ, Total). Ничего не складывай сам — бери напечатанный итог.\n"
    "currency — ISO-код, ТОЛЬКО если на чеке явно напечатан знак или название валюты (₽, руб, $, сум, тенге, €). "
    "Если валюты не видно — null, не угадывай по языку.\n"
    "date — дата покупки YYYY-MM-DD, если видна, иначе null.\n"
    "Если это не чек и не оплата — is_receipt: false."
)


class Receipt(BaseModel):
    is_receipt: bool
    merchant: str | None = None
    total: float | None = None
    currency: str | None = None
    date: str | None = None


_ISO = re.compile(r"^[A-Z]{3}$")
# модель иногда отвечает знаком или словом, а не кодом
_CURRENCY_WORDS = {"₽": "RUB", "РУБ": "RUB", "Р": "RUB", "$": "USD", "€": "EUR", "СУМ": "UZS", "SO'M": "UZS",
                   "ТЕНГЕ": "KZT", "₸": "KZT"}


def currency_code(raw: str | None) -> str | None:
    v = (raw or "").strip().upper().rstrip(".")
    if _ISO.match(v):
        return v
    return _CURRENCY_WORDS.get(v)


class ReceiptReader:
    def __init__(self, base_url: str, model: str, http: httpx.Client):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.http = http

    def read(self, path: Path) -> Receipt | None:
        """None — это не чек или итог не найден."""
        r = self.http.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": [{"role": "user", "content": PROMPT,
                              "images": [base64.b64encode(path.read_bytes()).decode()]}],
                # «json», а не строгая схема: со схемой qwen2.5vl оставляет название магазина пустым
                "format": "json",
                "stream": False,
                "options": {"temperature": 0},
                # редкий гость: видеопамять нужнее основной модели — выгружаем через минуту
                "keep_alive": "1m",
            },
            timeout=300,
        )
        r.raise_for_status()
        try:
            got = Receipt.model_validate_json(r.json()["message"]["content"])
        except (ValidationError, KeyError, ValueError):
            return None
        if not got.is_receipt or not got.total or got.total <= 0:
            return None
        return got


def merchant_name(raw: str | None) -> str | None:
    """«ООО «Агроторг» Магазин «Пятёрочка» №1123» → «Пятёрочка»: из нескольких названий в кавычках
    вывеска обычно последняя; без кавычек — убираем «Магазин», форму собственности и номер точки."""
    v = (raw or "").strip()
    quoted = re.findall(r"[«\"“]([^»\"”]+)[»\"”]", v)
    if quoted:
        v = quoted[-1]
    v = re.sub(r"^(?:магазин|кафе|ресторан|аптека|ооо|ип|ао|пао|зао)\s+", "", v, flags=re.IGNORECASE)
    v = re.sub(r"\s*№\s*\d+\s*$", "", v)
    v = v.strip(" «»\"'“”")
    return v or None


def compose(rc: Receipt, caption: str | None, today: date) -> str:
    """Фраза для обычного разбора. Подпись к фото важнее названия магазина: «обед с командой»."""
    parts: list[str] = []
    when = _date(rc.date, today)
    if when:
        parts.append(when.strftime("%d.%m.%Y"))
    amount = f"{rc.total:.2f}".rstrip("0").rstrip(".")
    parts += ["потратил", amount]
    cur = currency_code(rc.currency)
    if cur:
        parts.append(f"(валюта {cur})")
    if caption and caption.strip():
        parts.append(f"на {caption.strip()}")
    elif name := merchant_name(rc.merchant):
        parts.append(f"в «{name}»")
    else:
        parts.append("по чеку")  # иначе модель назовёт трату безликим «Трата»
    return " ".join(parts)


def _date(raw: str | None, today: date) -> date | None:
    """Дата из чека (YYYY-MM-DD или ДД.ММ.ГГГГ / ДД.ММ.ГГ), если она правдоподобна: не из будущего и не старше года."""
    v = (raw or "").strip()
    try:
        if m := re.fullmatch(r"(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})", v):
            y = int(m.group(3))
            d = date(y + 2000 if y < 100 else y, int(m.group(2)), int(m.group(1)))
        else:
            d = date.fromisoformat(v)
    except ValueError:
        return None
    return d if (today - d).days in range(0, 366) else None
