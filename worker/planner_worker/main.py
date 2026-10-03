import logging
import time
from pathlib import Path

import httpx
from supabase import create_client

from .classifier import LayaClassifier
from .config import load_config
from .fx import fetch_latest
from .jobs import cleanup_tmp, run_job
from .llm import Extractor, OllamaClient
from .pipeline import Pipeline, notify_failed, run_one
from .shortcut import ShortcutSigner
from .store import Store
from .stt import Transcriber
from .telegram import TelegramClient

HEARTBEAT_EVERY = 30.0
log = logging.getLogger("planner_worker")


def tick(store, tg, pipeline, cfg, last_beat: float, job_runner=None) -> float:
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
            job = store.claim_job() if job_runner else None
            if job:
                log.info("job %s (%s, attempt %s)", job.get("id"), job.get("kind"), job.get("attempts"))
                if not job_runner(job):
                    time.sleep(cfg.poll_interval * 5)
                return last_beat
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
    for noisy in ("httpx", "httpcore"):  # their INFO logs contain the bot token in URLs
        logging.getLogger(noisy).setLevel(logging.WARNING)
    cfg = load_config()
    http = httpx.Client()
    store = Store(create_client(cfg.supabase_url, cfg.supabase_service_key))
    tg = TelegramClient(cfg.telegram_bot_token, http)
    classifier = LayaClassifier() if cfg.use_laya else None
    stt = Transcriber(cfg.whisper_model)
    pipeline = Pipeline(
        store=store,
        tg=tg,
        stt=stt,
        extractor=Extractor(OllamaClient(cfg.ollama_url, cfg.ollama_model, http)),
        classifier=classifier,
        fetch_rates=lambda: fetch_latest(http),
        threshold=cfg.laya_threshold,
        tmp_dir=Path(__file__).resolve().parents[1] / "tmp",
    )

    log.info("warming up models (laya=%s, llm=%s)…", cfg.use_laya, cfg.ollama_model)
    try:
        stt.warm_up()
    except Exception as e:  # без сети на старте — модель подгрузится при первом голосовом
        log.warning("whisper warm-up failed: %s", type(e).__name__)
    if classifier:
        classifier.warm_up()
    http.post(f"{cfg.ollama_url}/api/generate", json={"model": cfg.ollama_model, "keep_alive": "30m"}, timeout=180).raise_for_status()
    log.info("ready")

    tmp_dir = Path(__file__).resolve().parents[1] / "tmp"
    log.info("removed %s leftover shortcut files", cleanup_tmp(tmp_dir))
    signer = ShortcutSigner()
    job_runner = lambda job: run_job(job, store, tg, signer, cfg.supabase_url, tmp_dir)  # noqa: E731

    last_beat = 0.0
    while True:
        last_beat = tick(store, tg, pipeline, cfg, last_beat, job_runner=job_runner)


if __name__ == "__main__":
    main()
