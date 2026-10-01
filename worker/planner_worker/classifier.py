from dataclasses import dataclass

from .schemas import ExtractedItem

LAYA_GROUP: dict[str, str] = {
    "task": "task",
    "event": "event",
    "expense": "expense",
    "income": "income",
    "note": "note",
    "journal": "note",
    "habit_done": "habit",
    "habit_new": "habit",
}

SECTION_QUESTION = {
    "section": {
        "type": "choice",
        "instructions": "К какому разделу планера относится запись?",
        "criteria": {
            "task": "дело, которое нужно сделать в будущем: не забыть, надо, купить, оплатить",
            "event": "встреча или событие в определённое время",
            "expense": "уже потраченные деньги, покупка, цена",
            "income": "полученные деньги: зарплата, перевод, доход",
            "note": "мысль, идея, заметка, запись о дне",
            "habit": "привычка: сделал зарядку, хочу трекать чтение",
        },
    }
}


@dataclass(frozen=True)
class Classification:
    group: str
    confidence: float


class LayaClassifier:
    def __init__(self, agent=None):
        self._agent = agent

    def _get(self):
        if self._agent is None:
            import laya

            self._agent = laya.load("convaiinnovations/laya", subfolder="multilingual")
        return self._agent

    def warm_up(self) -> None:
        self.classify("прогрев")

    def classify(self, text: str) -> Classification:
        ans = self._get().predict({"body": text}, SECTION_QUESTION)["answers"]["section"]
        group = ans["choice"]
        return Classification(group, float(ans["probabilities"][group]))


def decide(item: ExtractedItem, cls: Classification | None, threshold: float) -> bool:
    if cls is None:
        return True
    return LAYA_GROUP[item.kind] == cls.group and cls.confidence >= threshold
