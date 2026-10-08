import logging
from pathlib import Path

from planner_worker.jobs import CAPTION, FAILED_TEXT, MANUAL_BUTTONS, cleanup_tmp, run_job
from planner_worker.shortcut import ShortcutSignError

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
    assert list(tmp_path.glob("*.shortcut")) == []  # временных файлов с токеном не остаётся


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
    assert run_job(job(), Store(), Tg(), Signer(), "https://x", tmp_path / "ok") is True
    # отдельная папка: в общей второй вызов взял бы файл из кэша и до подписи не дошёл
    assert run_job(job(), Store(), Tg(), Signer(fail=True), "https://x", tmp_path / "fail") is False


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


class CountingSigner(Signer):
    def __init__(self):
        super().__init__()
        self.calls = 0

    def sign(self, unsigned, signed):
        self.calls += 1
        super().sign(unsigned, signed)


def test_second_request_is_served_from_cache_without_signing(tmp_path):
    signer, tg = CountingSigner(), Tg()
    assert run_job(job(), Store(), tg, signer, "https://x.supabase.co", tmp_path)
    assert run_job({**job(), "id": "j2"}, Store(), tg, signer, "https://x.supabase.co", tmp_path)
    assert signer.calls == 1
    assert len(tg.docs) == 2 and tg.docs[0][2] == tg.docs[1][2]


def test_cache_files_do_not_carry_the_token_in_their_name_and_are_private(tmp_path):
    run_job(job(), Store(), Tg(), Signer(), "https://x.supabase.co", tmp_path)
    cached = list((tmp_path / "cache").iterdir())
    assert len(cached) == 1
    assert TOKEN not in cached[0].name
    assert cached[0].stat().st_mode & 0o077 == 0
    assert cleanup_tmp(tmp_path) == 0  # уборка временных файлов кэш не трогает


def test_sign_failure_logs_the_reason(tmp_path, caplog):
    class Failing:
        def sign(self, unsigned, signed):
            raise ShortcutSignError("shortcuts sign failed (1): network unavailable")
    caplog.set_level(logging.WARNING)
    run_job(job(), Store(), Tg(), Failing(), "https://x.supabase.co", tmp_path)
    assert "network unavailable" in caplog.text and TOKEN not in caplog.text


def test_done_is_logged_with_duration(tmp_path, caplog):
    caplog.set_level(logging.INFO)
    run_job(job(), Store(), Tg(), Signer(), "https://x.supabase.co", tmp_path)
    assert "job j1 done in" in caplog.text and "signed" in caplog.text


def test_caption_explains_the_home_screen_widget():
    assert "Добавить виджет" in CAPTION and "«Команды»" in CAPTION
