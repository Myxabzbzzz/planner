import hashlib
import inspect
import logging
import os
import time
from pathlib import Path

from . import shortcut as shortcut_module
from .shortcut import ShortcutSignError, build_shortcut

# Меняется код сборки команды — меняется и ключ кэша, старые файлы больше не отдаются.
_BUILDER_VERSION = hashlib.sha256(inspect.getsource(shortcut_module).encode()).hexdigest()

log = logging.getLogger(__name__)

CAPTION = ("📲 Команда «Планер» для двойного тапа\n"
           "1. Нажми на файл → «Добавить команду».\n"
           "2. Настройки → Универсальный доступ → Касание → Касание задней панели → Двойное касание → «Планер».\n"
           "3. Кнопка на экране «Домой»: зажми пустое место → «Править» → «Добавить виджет» → «Команды» → "
           "выбери «Планер».\n"
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


def _signed_bytes(supabase_url: str, token: str, job_id: str, signer, tmp_dir: Path) -> tuple[bytes, bool]:
    """Подпись идёт через серверы Apple: секунды, а без сети — ошибка. Подписанный файл
    кэшируем: новый токен, адрес или код сборки команды — новый ключ.
    Имя файла — хэш, токена в нём нет; права 0600, как у worker/.env."""
    cache = tmp_dir / "cache"
    key = hashlib.sha256(f"{_BUILDER_VERSION}\n{supabase_url}\n{token}".encode()).hexdigest()
    hit = cache / f"{key}.signed"
    if hit.exists():
        return hit.read_bytes(), True
    unsigned_bytes = build_shortcut(supabase_url, token)
    unsigned = tmp_dir / f"{job_id}-unsigned.shortcut"
    signed = tmp_dir / f"{job_id}.shortcut"
    try:
        unsigned.write_bytes(unsigned_bytes)
        signer.sign(unsigned, signed)
        data = signed.read_bytes()
    finally:
        unsigned.unlink(missing_ok=True)
        signed.unlink(missing_ok=True)
    cache.mkdir(mode=0o700, exist_ok=True)
    fd = os.open(hit, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return data, False


def run_job(job: dict, store, tg, signer, supabase_url: str, tmp_dir: Path) -> bool:
    started = time.monotonic()
    try:
        if job["kind"] != "shortcut_file":
            raise ValueError("unknown job kind")
        token = store.capture_token(job["user_id"])
        tmp_dir.mkdir(parents=True, exist_ok=True)
        data, cached = _signed_bytes(supabase_url, token, job["id"], signer, tmp_dir)
        tg.send_document(job["chat_id"], "Планер.shortcut", data, CAPTION)
        store.finish_job(job["id"], "done", None)
        log.info("job %s done in %.1fs (%s)", job["id"], time.monotonic() - started, "cached" if cached else "signed")
        return True
    except Exception as e:  # noqa: BLE001 — только тип: текст может содержать токен
        # кроме ошибки подписи: её текст наш и вывод `shortcuts`, без токена
        err = str(e) if isinstance(e, ShortcutSignError) else type(e).__name__
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
