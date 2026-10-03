import logging
from pathlib import Path

from planner_worker.jobs import CAPTION, FAILED_TEXT, MANUAL_BUTTONS, cleanup_tmp, run_job

TOKEN = "f" * 64


class Store:
    def __init__(self):
        self.finished = []

    def capture_token(self, user_id):
        return TOKEN

    def finish_job(self, job_id, status, error):
        self.finished.append((job_id, status, error))


class Tg:
    def __init__(self, fail=False):
        self.fail, self.docs, self.sent = fail, [], []

    def send_document(self, chat_id, filename, data, caption):
        if self.fail:
            raise RuntimeError(f"boom {TOKEN}")
        self.docs.append((chat_id, filename, data, caption))

    def send(self, chat_id, text, buttons=None):
        self.sent.append((chat_id, text, buttons))


class Signer:
    def __init__(self, fail=False):
        self.fail = fail

    def sign(self, unsigned: Path, signed: Path):
        if self.fail:
            raise RuntimeError("shortcuts sign failed (1)")
        signed.write_bytes(b"SIGNED:" + unsigned.read_bytes()[:4])


def job(attempts=1):
    return {"id": "j1", "user_id": "u1", "kind": "shortcut_file", "chat_id": 777, "attempts": attempts}


def test_success_sends_signed_file_and_cleans_up(tmp_path):
    store, tg = Store(), Tg()
    run_job(job(), store, tg, Signer(), "https://x.supabase.co", tmp_path)
    chat, name, data, caption = tg.docs[0]
    assert (chat, name, caption) == (777, "Планер.shortcut", CAPTION)
    assert data.startswith(b"SIGNED:")
    assert store.finished == [("j1", "done", None)]
    assert list(tmp_path.iterdir()) == []


def test_sign_failure_retries_then_fails_with_manual_hint(tmp_path):
    store, tg = Store(), Tg()
    run_job(job(attempts=1), store, tg, Signer(fail=True), "https://x", tmp_path)
    assert store.finished[-1] == ("j1", "pending", "RuntimeError")
    run_job(job(attempts=3), store, tg, Signer(fail=True), "https://x", tmp_path)
    assert store.finished[-1] == ("j1", "failed", "RuntimeError")
    assert tg.sent == [(777, FAILED_TEXT, MANUAL_BUTTONS)]
    assert list(tmp_path.iterdir()) == []


def test_token_never_logged_or_stored(tmp_path, caplog):
    store, tg = Store(), Tg(fail=True)
    with caplog.at_level(logging.DEBUG):
        run_job(job(attempts=3), store, tg, Signer(), "https://x", tmp_path)
    assert TOKEN not in caplog.text
    assert all(TOKEN not in (e or "") for _, _, e in store.finished)


def test_run_job_returns_bool(tmp_path):
    assert run_job(job(), Store(), Tg(), Signer(), "https://x", tmp_path) is True
    assert run_job(job(), Store(), Tg(), Signer(fail=True), "https://x", tmp_path) is False


def test_failing_finish_job_does_not_escape_or_leak(tmp_path, caplog):
    class BadStore(Store):
        def finish_job(self, job_id, status, error):
            raise RuntimeError(f"db {TOKEN}")

    with caplog.at_level(logging.DEBUG):
        for attempts in (1, 3):
            assert run_job(job(attempts=attempts), BadStore(), Tg(fail=True), Signer(), "https://x", tmp_path) is False
    assert TOKEN not in caplog.text


def test_cleanup_tmp_removes_leftover_shortcuts(tmp_path):
    (tmp_path / "a.shortcut").write_bytes(b"1")
    (tmp_path / "b-unsigned.shortcut").write_bytes(b"2")
    (tmp_path / "keep.txt").write_bytes(b"3")
    assert cleanup_tmp(tmp_path) == 2
    assert [p.name for p in tmp_path.iterdir()] == ["keep.txt"]
    assert cleanup_tmp(tmp_path / "missing") == 0
