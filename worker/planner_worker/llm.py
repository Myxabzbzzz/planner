import httpx
from pydantic import ValidationError

from .prompts import EXTRACTION_SCHEMA, build_extract_messages
from .schemas import ExtractedItem, Extraction, UserContext


class ExtractionError(Exception):
    pass


class OllamaClient:
    def __init__(self, base_url: str, model: str, http: httpx.Client):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.http = http

    def chat_json(self, messages: list[dict], schema: dict) -> str:
        r = self.http.post(
            f"{self.base_url}/api/chat",
            json={
                "model": self.model,
                "messages": messages,
                "format": schema,
                "stream": False,
                "think": False,
                "options": {"temperature": 0},
            },
            timeout=180,
        )
        r.raise_for_status()
        return r.json()["message"]["content"]


class Extractor:
    def __init__(self, llm):
        self.llm = llm

    def extract(
        self, text: str, ctx: UserContext, hint_kind: str | None = None, feedback: list[str] | None = None
    ) -> list[ExtractedItem]:
        messages = build_extract_messages(text, ctx, hint_kind, feedback)
        last: Exception | None = None
        for _ in range(2):
            raw = self.llm.chat_json(messages, EXTRACTION_SCHEMA)
            try:
                return Extraction.model_validate_json(raw).items
            except ValidationError as e:
                last = e
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": f"Ответ не прошёл проверку схемы: {e.errors(include_url=False)}. Верни исправленный JSON."},
                ]
        raise ExtractionError(str(last))
