from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Kind = Literal["task", "event", "expense", "income", "note", "journal", "habit_done", "habit_new"]
KINDS: tuple[str, ...] = ("task", "event", "expense", "income", "note", "journal", "habit_done", "habit_new")


class ExtractedItem(BaseModel):
    kind: Kind
    title: str
    source_text: str
    due_at: datetime | None = None
    priority: Literal["low", "normal", "high"] = "normal"
    starts_at: datetime | None = None
    duration_min: int | None = None
    with_whom: str | None = None
    amount: float | None = None
    currency: str | None = None
    category: str | None = None
    occurred_on: date | None = None
    habit: str | None = None


class Extraction(BaseModel):
    items: list[ExtractedItem]


@dataclass(frozen=True)
class UserContext:
    user_id: str
    tz: str
    base_currency: str
    now: datetime
    expense_categories: dict[str, str]
    income_categories: dict[str, str]
    habits: dict[str, str]


@dataclass
class InboxRow:
    id: str
    user_id: str
    source: str
    text: str | None
    audio_ref: str | None
    attempts: int
    result: dict = field(default_factory=dict)
    reply_chat_id: int | None = None
    reply_message_id: int | None = None

    @classmethod
    def from_db(cls, r: dict) -> InboxRow:
        return cls(
            id=r["id"],
            user_id=r["user_id"],
            source=r["source"],
            text=r.get("text"),
            audio_ref=r.get("audio_ref"),
            attempts=r.get("attempts") or 0,
            result=r.get("result") or {},
            reply_chat_id=r.get("reply_chat_id"),
            reply_message_id=r.get("reply_message_id"),
        )
