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


def test_download_http_error_does_not_leak_token(tmp_path):
    def handler(req):
        if "getFile" in str(req.url):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "voice/a.oga"}})
        return httpx.Response(404)

    with pytest.raises(TelegramError) as ei:
        client(handler).download("fid", tmp_path)
    assert "TOKEN" not in str(ei.value)


def test_connect_error_does_not_leak_token():
    def handler(req):
        raise httpx.ConnectError("boom", request=req)

    with pytest.raises(TelegramError) as ei:
        client(handler).send(5, "hi")
    assert "TOKEN" not in str(ei.value)
    assert ei.value.__cause__ is None


def test_non_json_response_does_not_leak_token():
    with pytest.raises(TelegramError) as ei:
        client(lambda req: httpx.Response(502, text="<html>bad gateway</html>")).send(5, "hi")
    assert "TOKEN" not in str(ei.value)
