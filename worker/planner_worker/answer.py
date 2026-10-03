from pydantic import ValidationError

from .prompts import QUESTION_SCHEMA, build_question_messages
from .schemas import Question, UserContext


class QuestionParser:
    def __init__(self, llm):
        self.llm = llm

    def parse(self, text: str, ctx: UserContext) -> Question:
        messages = build_question_messages(text, ctx)
        for _ in range(2):
            raw = self.llm.chat_json(messages, QUESTION_SCHEMA)
            try:
                return Question.model_validate_json(raw)
            except ValidationError as e:
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": f"Ответ не прошёл проверку схемы: {e.errors(include_url=False)}. Верни исправленный JSON."},
                ]
        return Question(intent="unknown")
