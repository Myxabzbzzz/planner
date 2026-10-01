import logging
import time
from pathlib import Path

import httpx
from supabase import create_client

from .classifier import LayaClassifier
from .config import load_config
from .fx import fetch_latest
from .llm import Extractor, OllamaClient
from .pipeline import Pipeline, notify_failed, run_one
from .store import Store
from .stt import Transcriber
from .telegram import TelegramClient

HEARTBEAT_EVERY = 30.0
log = logging.getLogger("planner_worker")


def tick(store, tg, pipeline, cfg, last_beat: float) -> float:
    """One loop iteration; never raises on transient errors. Returns new last_beat."""
    if time.monotonic() - last_beat >= HEARTBEAT_EVERY:
        last_beat = time.monotonic()
        try:
            store.heartbeat(cfg.worker_id)
        except Exception:
            log.exception("heartbeat failed")
        try:
            notify_failed(store, tg)
        except Exception:
            log.exception("notify_failed failed")
    try:
        row = store.claim()
        if row is None:
            time.sleep(cfg.poll_interval)
            return last_beat
        log.info("processing %s (%s, attempt %s)", row.id, row.source, row.attempts)
        run_one(row, pipeline, store, tg)
    except Exception:
        log.exception("loop error")
        time.sleep(cfg.poll_interval)
    return last_beat


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    http = httpx.Client()
    store = Store(create_client(cfg.supabase_url, cfg.supabase_service_key))
    tg = TelegramClient(cfg.telegram_bot_token, http)
    classifier = LayaClassifier() if cfg.use_laya else None
    pipeline = Pipeline(
        store=store,
        tg=tg,
        stt=Transcriber(cfg.whisper_model),
        extractor=Extractor(OllamaClient(cfg.ollama_url, cfg.ollama_model, http)),
        classifier=classifier,
        fetch_rates=lambda: fetch_latest(http),
        threshold=cfg.laya_threshold,
        tmp_dir=Path(__file__).resolve().parents[1] / "tmp",
    )

    log.info("warming up models (laya=%s, llm=%s)…", cfg.use_laya, cfg.ollama_model)
    if classifier:
        classifier.warm_up()
    http.post(f"{cfg.ollama_url}/api/generate", json={"model": cfg.ollama_model, "keep_alive": "30m"}, timeout=180).raise_for_status()
    log.info("ready")

    last_beat = 0.0
    while True:
        last_beat = tick(store, tg, pipeline, cfg, last_beat)


if __name__ == "__main__":
    main()
