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
    http.post(f"{cfg.ollama_url}/api/generate", json={"model": cfg.ollama_model, "keep_alive": "30m"}, timeout=180)
    log.info("ready")

    last_beat = 0.0
    while True:
        if time.monotonic() - last_beat >= HEARTBEAT_EVERY:
            store.heartbeat(cfg.worker_id)
            notify_failed(store, tg)
            last_beat = time.monotonic()
        row = store.claim()
        if row is None:
            time.sleep(cfg.poll_interval)
            continue
        log.info("processing %s (%s, attempt %s)", row.id, row.source, row.attempts)
        run_one(row, pipeline, store, tg)


if __name__ == "__main__":
    main()
