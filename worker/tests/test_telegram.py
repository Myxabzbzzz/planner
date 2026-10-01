import json

import httpx
import pytest

from planner_worker.telegram import TelegramClient, TelegramError


def client(handler):
    return TelegramClient("TOKEN", httpx.Client(transport=httpx.MockTransport(handler)))


def test_send_returns_message_id_and_passes_buttons():
    seen = {}

    def handler(req):
        seen["url"] = str(req.url)
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 42}})

    mid = client(handler).send(5, "hi", [[{"text": "A", "callback_data": "a"}]])
    assert mid == 42
    assert seen["url"] == "https://api.telegram.org/botTOKEN/sendMessage"
    assert seen["body"]["reply_markup"] == {"inline_keyboard": [[{"text": "A", "callback_data": "a"}]]}


def test_edit_ignores_not_modified():
    def handler(req):
        return httpx.Response(400, json={"ok": False, "description": "Bad Request: message is not modified"})

    client(handler).edit(5, 6, "same")


def test_edit_raises_other_errors():
    def handler(req):
        return httpx.Response(400, json={"ok": False, "description": "Bad Request: chat not found"})

    with pytest.raises(TelegramError, match="chat not found"):
        client(handler).edit(5, 6, "x")


def test_download_saves_file(tmp_path):
    def handler(req):
        if req.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "voice/file_1.oga"}})
        assert str(req.url) == "https://api.telegram.org/file/botTOKEN/voice/file_1.oga"
        return httpx.Response(200, content=b"OGG")

    p = client(handler).download("F1", tmp_path)
    assert p == tmp_path / "file_1.oga"
    assert p.read_bytes() == b"OGG"
