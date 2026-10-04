from datetime import datetime, timedelta, timezone
from pathlib import Path

from planner_worker.store import Store

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)


class FakeBucket:
    def __init__(self):
        self.tree = {
            "u1": [{"name": "old.m4a", "id": "1", "created_at": (NOW - timedelta(hours=25)).isoformat()},
                   {"name": "new.m4a", "id": "2", "created_at": (NOW - timedelta(hours=1)).isoformat()}],
            "u2": [{"name": "old.webm", "id": "3", "created_at": "2026-10-01T00:00:00Z"}],
        }
        self.files = {"u1/new.m4a": b"audio"}
        self.removed: list[str] = []

    def list(self, path=None):
        if not path:
            return [{"name": k, "id": None} for k in self.tree]
        return self.tree.get(path, [])

    def download(self, path):
        return self.files[path]

    def remove(self, paths):
        self.removed.extend(paths)
        return []


class FakeStorage:
    def __init__(self, bucket):
        self.bucket = bucket

    def from_(self, name):
        assert name == "audio"
        return self.bucket


class FakeTable:
    def __init__(self, log):
        self.log = log

    def update(self, values):
        self.log.append(("update", values))
        return self

    def eq(self, col, val):
        self.log.append(("eq", col, val))
        return self

    def execute(self):
        return self


class FakeSb:
    def __init__(self):
        self.bucket = FakeBucket()
        self.storage = FakeStorage(self.bucket)
        self.log: list = []

    def table(self, name):
        assert name == "inbox"
        return FakeTable(self.log)


def test_download_writes_file(tmp_path):
    sb = FakeSb()
    p = Store(sb).download_audio("u1/new.m4a", tmp_path / "d")
    assert p == tmp_path / "d" / "new.m4a" and p.read_bytes() == b"audio"


def test_remove_and_set_text():
    sb = FakeSb()
    s = Store(sb)
    s.remove_audio("u1/new.m4a")
    s.set_text("i1", "кофе 40 000")
    assert sb.bucket.removed == ["u1/new.m4a"]
    assert sb.log == [("update", {"text": "кофе 40 000"}), ("eq", "id", "i1")]


def test_sweep_removes_only_older_than_a_day():
    sb = FakeSb()
    assert Store(sb).sweep_audio(NOW) == 2
    assert sorted(sb.bucket.removed) == ["u1/old.m4a", "u2/old.webm"]
