import re

STRONG = {"сколько", "покажи", "сравни", "какие", "какой", "какая", "каких", "какое"}
WEAK = {"что", "когда", "где", "как", "чем", "осталось"}  # «Осталось оплатить интернет» — запись

_LEAD = re.compile(r"^\W+")
_WORD = re.compile(r"\w[\w-]*")
_TAIL = re.compile(r"[^\w?]+$")


def is_question(text: str | None) -> bool:
    """Вопрос к данным: начинается со слова-маркера (слабым маркерам нужен «?» в конце)."""
    t = _LEAD.sub("", (text or "").strip().lower().replace("ё", "е"))
    words = _WORD.findall(t)
    if not words:
        return False
    first = words[0]
    if first in STRONG or (first == "на" and len(words) > 1 and words[1] == "что"):
        return True
    return first in WEAK and _TAIL.sub("", t).endswith("?")
