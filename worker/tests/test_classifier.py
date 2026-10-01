from planner_worker.classifier import Classification, LayaClassifier, decide
from planner_worker.schemas import ExtractedItem


class FakeAgent:
    def __init__(self, choice, probs):
        self.choice, self.probs = choice, probs
        self.calls = []

    def predict(self, state, questions):
        self.calls.append((state, questions))
        return {"answers": {"section": {"type": "choice", "choice": self.choice, "probabilities": self.probs,
                                        "confidence": 0.9, "answer_confidence": self.probs[self.choice]}}}


def it(kind):
    return ExtractedItem(kind=kind, title="x", source_text="x")


def test_classify_returns_choice_probability():
    agent = FakeAgent("expense", {"task": 0.02, "expense": 0.97, "event": 0.01})
    c = LayaClassifier(agent).classify("потратил 500 на такси")
    assert c == Classification("expense", 0.97)
    state, questions = agent.calls[0]
    assert state == {"body": "потратил 500 на такси"}
    assert set(questions["section"]["criteria"]) == {"task", "event", "expense", "income", "note", "habit"}


def test_decide_accepts_agreement_above_threshold():
    assert decide(it("expense"), Classification("expense", 0.9), 0.7) is True


def test_decide_rejects_disagreement():
    assert decide(it("task"), Classification("expense", 0.97), 0.7) is False


def test_decide_rejects_low_confidence():
    assert decide(it("expense"), Classification("expense", 0.5), 0.7) is False


def test_decide_maps_journal_and_habits_to_groups():
    assert decide(it("journal"), Classification("note", 0.9), 0.7) is True
    assert decide(it("habit_new"), Classification("habit", 0.9), 0.7) is True


def test_decide_without_laya_accepts():
    assert decide(it("task"), None, 0.7) is True
