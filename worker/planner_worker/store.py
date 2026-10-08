import logging
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from decimal import Decimal
from zoneinfo import ZoneInfo

from .fx import RateTable
from .schemas import InboxRow, UserContext

AUDIO_BUCKET = "audio"
log = logging.getLogger(__name__)


class Store:
    def __init__(self, client):
        self.sb = client

    def claim(self) -> InboxRow | None:
        data = self.sb.rpc("claim_inbox").execute().data
        return InboxRow.from_db(data[0]) if data else None

    def heartbeat(self, worker_id: str) -> None:
        self.sb.table("worker_heartbeat").upsert(
            {"worker_id": worker_id, "seen_at": datetime.now(timezone.utc).isoformat()}).execute()

    def load_context(self, user_id: str, now_utc: datetime) -> UserContext:
        u = self.sb.table("users").select("tz,base_currency").eq("id", user_id).single().execute().data
        cats = self.sb.table("categories").select("id,name,type").eq("user_id", user_id).execute().data
        habits = (self.sb.table("habits").select("id,name").eq("user_id", user_id)
                  .is_("archived_at", "null").execute().data)
        return UserContext(
            user_id=user_id,
            tz=u["tz"],
            base_currency=u["base_currency"],
            now=now_utc.astimezone(ZoneInfo(u["tz"])),
            expense_categories={c["name"].lower(): c["id"] for c in cats if c["type"] == "expense"},
            income_categories={c["name"].lower(): c["id"] for c in cats if c["type"] == "income"},
            habits={h["name"].lower(): h["id"] for h in habits},
            corrections=self.corrections(user_id),
        )

    def corrections(self, user_id: str, limit: int = 20) -> tuple[tuple[str, str], ...]:
        """Что пользователь уже исправлял вручную — подмешиваем в few-shot промпта.
        Без сети/таблицы работаем как раньше: пустой кортеж."""
        try:
            rows = self.sb.rpc("recent_corrections", {"p_user": user_id, "p_limit": limit}).execute().data or []
        except Exception as e:  # noqa: BLE001 — подсказки необязательны, разбор должен идти и без них
            log.warning("corrections unavailable: %s", type(e).__name__)
            return ()
        return tuple((r["text"], r["kind"]) for r in rows if r.get("text") and r.get("kind"))

    def rates_on(self, d: date) -> RateTable | None:
        rows = (self.sb.table("fx_rates").select("date,rates,source").lte("date", d.isoformat())
                .order("date", desc=True).limit(1).execute().data)
        if not rows:
            return None
        r = rows[0]
        return RateTable(date.fromisoformat(r["date"]), {k: Decimal(str(v)) for k, v in r["rates"].items()},
                         r["source"])

    def save_rates(self, t: RateTable) -> None:
        self.sb.table("fx_rates").upsert({
            "date": t.date.isoformat(), "base": "USD", "rates": {k: float(v) for k, v in t.rates.items()},
            "source": t.source}).execute()

    def insert(self, table: str, row: dict) -> None:
        if table == "habit_logs":
            self.sb.table(table).upsert(row, on_conflict="habit_id,date").execute()
        elif table == "habits":  # повторное «хочу трекать X» разархивирует X
            self.sb.table(table).upsert(row, on_conflict="user_id,name").execute()
        else:
            self.sb.table(table).insert(row).execute()

    def finish(self, inbox_id: str, status: str, result: dict, error: str | None = None,
               notified: bool = False) -> None:
        upd = {"status": status, "result": result, "error": error}
        if notified:
            upd["notified_at"] = datetime.now(timezone.utc).isoformat()
        self.sb.table("inbox").update(upd).eq("id", inbox_id).execute()

    def failed_unnotified(self) -> list[InboxRow]:
        data = (self.sb.table("inbox").select("*").eq("status", "failed").is_("notified_at", "null")
                .execute().data)
        return [InboxRow.from_db(r) for r in data]

    def mark_notified(self, inbox_id: str) -> None:
        self.sb.table("inbox").update({"notified_at": datetime.now(timezone.utc).isoformat()}) \
            .eq("id", inbox_id).execute()

    def clear_records(self, inbox_id: str) -> None:
        for table in ("items", "transactions", "notes", "habit_logs"):
            self.sb.table(table).delete().eq("inbox_id", inbox_id).execute()

    def claim_job(self) -> dict | None:
        data = self.sb.rpc("claim_job").execute().data
        return data[0] if data else None

    def capture_token(self, user_id: str) -> str:
        return self.sb.table("users").select("capture_token").eq("id", user_id).single().execute().data["capture_token"]

    def finish_job(self, job_id: str, status: str, error: str | None) -> None:
        self.sb.table("jobs").update({"status": status, "error": error}).eq("id", job_id).execute()

    def ask(self, fn: str, **params) -> dict:
        return self.sb.rpc(fn, params).execute().data

    def download_audio(self, key: str, dest_dir: Path) -> Path:
        data = self.sb.storage.from_(AUDIO_BUCKET).download(key)
        dest_dir.mkdir(parents=True, exist_ok=True)
        p = dest_dir / Path(key).name
        p.write_bytes(data)
        return p

    def remove_audio(self, key: str) -> None:
        self.sb.storage.from_(AUDIO_BUCKET).remove([key])

    def reply_message_id(self, inbox_id: str) -> int | None:
        data = self.sb.table("inbox").select("reply_message_id").eq("id", inbox_id).execute().data
        return data[0]["reply_message_id"] if data else None

    def set_text(self, inbox_id: str, text: str) -> None:
        self.sb.table("inbox").update({"text": text}).eq("id", inbox_id).execute()

    def sweep_audio(self, now_utc: datetime, max_age: timedelta = timedelta(hours=24)) -> int:
        """Удаляет файлы старше суток — страховка, если воркер упал между загрузкой и распознаванием."""
        bucket = self.sb.storage.from_(AUDIO_BUCKET)
        cutoff = now_utc - max_age
        waiting = {r["audio_ref"].removeprefix("storage:") for r in
                   self.sb.table("inbox").select("audio_ref").in_("status", ["pending", "processing"])
                   .like("audio_ref", "storage:%").execute().data}  # ноутбук спал дольше суток — запись ещё ждёт
        old = []
        for folder in bucket.list():
            if folder.get("id") is not None:  # файл в корне — не наш формат пути
                continue
            for f in bucket.list(folder["name"]):
                created = f.get("created_at")
                key = f"{folder['name']}/{f['name']}"
                if created and key not in waiting and datetime.fromisoformat(created.replace("Z", "+00:00")) < cutoff:
                    old.append(key)
        if old:
            bucket.remove(old)
        return len(old)
