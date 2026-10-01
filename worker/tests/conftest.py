from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from planner_worker.schemas import UserContext


@pytest.fixture
def ctx() -> UserContext:
    return UserContext(
        user_id="u1",
        tz="Asia/Tashkent",
        base_currency="UZS",
        now=datetime(2026, 10, 1, 10, 0, tzinfo=ZoneInfo("Asia/Tashkent")),
        expense_categories={"еда": "c-food", "кафе": "c-cafe", "такси/транспорт": "c-taxi",
                            "подписки": "c-subs", "другое": "c-exp-other"},
        income_categories={"зарплата": "c-salary", "другое": "c-inc-other"},
        habits={"зарядка": "h-gym", "чтение": "h-read"},
    )
