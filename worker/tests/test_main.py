import time
from types import SimpleNamespace

from planner_worker import main as m


class Store:
    def __init__(self, hb_error=False, claim_error=False):
        self.hb_error, self.claim_error = hb_error, claim_error
        self.hb_calls = self.claim_calls = 0

    def heartbeat(self, worker_id):
        self.hb_calls += 1
        if self.hb_error:
            raise RuntimeError("db down")

    def claim(self):
        self.claim_calls += 1
        if self.claim_error:
            raise RuntimeError("db down")
        return None

    def failed_unnotified(self):
        return []


CFG = SimpleNamespace(worker_id="w", poll_interval=0)


def test_heartbeat_error_does_not_stop_claim():
    s = Store(hb_error=True)
    last = m.tick(s, None, None, CFG, 0.0)
    assert s.hb_calls == 1 and s.claim_calls == 1
    assert last > 0


def test_claim_error_is_contained():
    s = Store(claim_error=True)
    m.tick(s, None, None, CFG, time.monotonic())
    assert s.claim_calls == 1


def test_heartbeat_not_due_is_skipped():
    s = Store()
    now = time.monotonic()
    assert m.tick(s, None, None, CFG, now) == now
    assert s.hb_calls == 0


def test_main_silences_httpx_logging(monkeypatch):
    import logging

    monkeypatch.setattr(m, "load_config", lambda: (_ for _ in ()).throw(SystemExit))
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.INFO)
    try:
        m.main()
    except SystemExit:
        pass
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING
