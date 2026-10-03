import logging
from pathlib import Path

from .shortcut import build_shortcut

log = logging.getLogger(__name__)

CAPTION = ("📲 Команда «Планер» для двойного тапа\n"
           "1. Нажми на файл → «Добавить команду».\n"
           "2. Настройки → Универсальный доступ → Касание → Касание задней панели → Двойное касание → «Планер».\n"
           "Готово: стукни дважды и скажи, что записать.")
FAILED_TEXT = "😵 Не получилось собрать файл команды — настрой вручную."
MANUAL_BUTTONS = [[{"text": "📝 Настроить вручную", "callback_data": "tap:manual"}]]


def cleanup_tmp(tmp_dir: Path) -> int:
    """Delete leftover *.shortcut files (may hold a capture token); returns count."""
    n = 0
    if tmp_dir.is_dir():
        for f in tmp_dir.glob("*.shortcut"):
            f.unlink(missing_ok=True)
            n += 1
    return n


def _finish(store, job_id, status, error) -> None:
    try:
        store.finish_job(job_id, status, error)
    except Exception as e:  # noqa: BLE001 — только тип
        log.warning("job %s: finish_job failed: %s", job_id, type(e).__name__)


def run_job(job: dict, store, tg, signer, supabase_url: str, tmp_dir: Path) -> bool:
    try:
        if job["kind"] != "shortcut_file":
            raise ValueError("unknown job kind")
        token = store.capture_token(job["user_id"])
        tmp_dir.mkdir(parents=True, exist_ok=True)
        unsigned = tmp_dir / f"{job['id']}-unsigned.shortcut"
        signed = tmp_dir / f"{job['id']}.shortcut"
        try:
            unsigned.write_bytes(build_shortcut(supabase_url, token))
            signer.sign(unsigned, signed)
            tg.send_document(job["chat_id"], "Планер.shortcut", signed.read_bytes(), CAPTION)
        finally:
            unsigned.unlink(missing_ok=True)
            signed.unlink(missing_ok=True)
        store.finish_job(job["id"], "done", None)
        return True
    except Exception as e:  # noqa: BLE001 — только тип: текст может содержать токен
        err = type(e).__name__
        log.warning("job %s failed: %s", job["id"], err)
        if job["attempts"] < 3:
            _finish(store, job["id"], "pending", err)
            return False
        _finish(store, job["id"], "failed", err)
        try:
            tg.send(job["chat_id"], FAILED_TEXT, MANUAL_BUTTONS)
        except Exception:  # noqa: BLE001
            log.warning("job %s: failed to notify user", job["id"])
    return False
