from pathlib import Path

import httpx


class TelegramError(Exception):
    pass


class TelegramClient:
    def __init__(self, token: str, http: httpx.Client):
        self.base = f"https://api.telegram.org/bot{token}"
        self.file_base = f"https://api.telegram.org/file/bot{token}"
        self.http = http

    def _call(self, method: str, payload: dict):
        try:
            data = self.http.post(f"{self.base}/{method}", json=payload, timeout=30).json()
        except (httpx.HTTPError, ValueError) as e:  # URL (with token) must not leak into messages
            raise TelegramError(f"{method}: {type(e).__name__}") from None
        if not data.get("ok"):
            raise TelegramError(f"{method}: {data.get('description')}")
        return data["result"]

    @staticmethod
    def _markup(buttons):
        return {"reply_markup": {"inline_keyboard": buttons}} if buttons else {}

    def send(self, chat_id: int, text: str, buttons: list[list[dict]] | None = None) -> int:
        return self._call("sendMessage", {"chat_id": chat_id, "text": text, **self._markup(buttons)})["message_id"]

    def edit(self, chat_id: int, message_id: int, text: str, buttons: list[list[dict]] | None = None) -> None:
        try:
            self._call("editMessageText",
                       {"chat_id": chat_id, "message_id": message_id, "text": text, **self._markup(buttons)})
        except TelegramError as e:
            if "message is not modified" not in str(e):
                raise

    def download(self, file_id: str, dest_dir: Path) -> Path:
        info = self._call("getFile", {"file_id": file_id})
        try:
            r = self.http.get(f"{self.file_base}/{info['file_path']}", timeout=60)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise TelegramError(f"download: {type(e).__name__}") from None
        dest_dir.mkdir(parents=True, exist_ok=True)
        p = dest_dir / Path(info["file_path"]).name
        p.write_bytes(r.content)
        return p
