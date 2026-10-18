"""Нагрузка на ИИ-разбор: сколько времени воркер разгребает пик сообщений.

В очередь разом кладётся N сообщений от разных людей (часть — голосовые), и настоящий Pipeline
разбирает их настоящими моделями (Ollama + Whisper) в 1, 2, 3… потоках, как воркер с
WORKER_CONCURRENCY. База и Telegram — в памяти, но каждый вызов ждёт --net-ms, как сеть до них.
Нагрузочный тест API (loadtest/) ИИ не трогает; этот — про ИИ.

    .venv/bin/python scripts/drain_bench.py                              # 60 сообщений, 1,2,3 потока
    .venv/bin/python scripts/drain_bench.py -n 120 --lanes 1,4 --voice 0.5 --whisper-device cpu

Рабочий воркер на этой же машине делит с тестом видеокарту — для чистых цифр его лучше
остановить: systemctl --user stop planner-worker.
"""
import argparse
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from planner_worker.fx import RateTable  # noqa: E402
from planner_worker.llm import Extractor, OllamaClient  # noqa: E402
from planner_worker.main import run_lanes  # noqa: E402
from planner_worker.pipeline import Pipeline, run_one  # noqa: E402
from planner_worker.schemas import InboxRow, UserContext  # noqa: E402
from planner_worker.stt import FASTER_DEFAULT, Transcriber  # noqa: E402

# типичные сообщения: траты, дела, встречи, заметки, привычки, по нескольку записей сразу
PHRASES = [
    "кофе 100", "такси до дома 45000", "купил продукты на 230 тысяч", "зарплата пришла 12 миллионов",
    "завтра в 10 встреча с Аней по проекту", "купить молоко и хлеб", "сделал зарядку",
    "в пятницу в 19:00 ужин с родителями", "оплатить интернет до 25 числа", "прочитал 30 страниц",
    "идея: сделать бота для заказа обедов в офис", "обед 85000, кофе 30000 и такси 25000",
    "через два часа позвонить в банк", "сегодня было тяжело, но я доволен днём",
    "netflix 12 долларов", "в субботу в 11 стрижка", "скинул Диме 200 тысяч за билеты",
    "к понедельнику подготовить отчёт для Олега", "аптека 64000", "в среду в 15:30 созвон с клиентом",
]
TZ = "Asia/Tashkent"
RATES = RateTable(date.today(), {"USD": Decimal(1), "UZS": Decimal(12600), "RUB": Decimal(95),
                                 "EUR": Decimal("0.92")}, "bench")


def context(user_id: str) -> UserContext:
    return UserContext(
        user_id=user_id, tz=TZ, base_currency="UZS", now=datetime.now(ZoneInfo(TZ)),
        expense_categories={n: n for n in ["еда", "кафе", "такси/транспорт", "дом", "связь", "подписки",
                                            "развлечения", "здоровье", "другое"]},
        income_categories={"зарплата": "зарплата", "другое": "другое"},
        habits={"зарядка": "зарядка", "чтение": "чтение"},
    )


class Net:
    """Задержка сети до Supabase / Telegram на каждый вызов."""

    def __init__(self, ms: float):
        self.s = ms / 1000

    def wait(self) -> None:
        if self.s:
            time.sleep(self.s)


class MemoryStore:
    """Очередь inbox в памяти с теми же правилами, что claim_inbox: по одному сообщению
    человека за раз, первым — тот, кому досталось меньше всех, при равенстве — самое старое."""

    def __init__(self, net: Net, audio_dir: Path):
        self.net, self.audio_dir = net, audio_dir
        self.lock = threading.Lock()
        self.rows: dict[str, dict] = {}

    def add(self, row: InboxRow) -> None:
        self.rows[row.id] = {"row": row, "status": "pending", "created": time.monotonic(),
                             "claimed": None, "finished": None, "served": 0}

    def claim(self) -> InboxRow | None:
        self.net.wait()
        with self.lock:
            busy = {r["row"].user_id for r in self.rows.values() if r["status"] == "processing"}
            served: dict[str, int] = {}
            for r in self.rows.values():
                if r["status"] != "pending":
                    served[r["row"].user_id] = served.get(r["row"].user_id, 0) + 1
            pending = [r for r in self.rows.values() if r["status"] == "pending" and r["row"].user_id not in busy]
            if not pending:
                return None
            r = min(pending, key=lambda r: (served.get(r["row"].user_id, 0), r["created"]))
            r["status"], r["claimed"] = "processing", time.monotonic()
            r["row"].attempts += 1
            return r["row"]

    def finish(self, inbox_id: str, status: str, result: dict, error: str | None = None,
               notified: bool = False) -> None:
        self.net.wait()
        with self.lock:
            r = self.rows[inbox_id]
            r["status"], r["finished"], r["error"] = status, time.monotonic(), error

    def load_context(self, user_id: str, now_utc: datetime) -> UserContext:
        for _ in range(4):  # users, categories, habits, recent_corrections
            self.net.wait()
        return context(user_id)

    def download_audio(self, key: str, dest_dir: Path) -> Path:
        self.net.wait()
        dest_dir.mkdir(parents=True, exist_ok=True)
        p = dest_dir / f"{time.monotonic_ns()}-{Path(key).name}"
        shutil.copy(self.audio_dir / key, p)
        return p

    def rates_on(self, d: date) -> RateTable:
        self.net.wait()
        return RATES

    def ai_quota_use(self, user_id: str) -> bool:
        self.net.wait()
        return True

    def is_pro(self, user_id: str) -> bool:
        self.net.wait()
        return False

    def reply_message_id(self, inbox_id: str) -> None:
        self.net.wait()

    def create_recurrence(self, *a, **kw) -> str:
        self.net.wait()
        return "rec"

    def __getattr__(self, name):  # insert, clear_records, set_text, remove_audio… — просто запись в базу
        def call(*a, **kw):
            self.net.wait()
        return call


class MemoryTelegram:
    def __init__(self, net: Net):
        self.net = net

    def send(self, chat_id, text, buttons=None) -> int:
        self.net.wait()
        return 1

    def edit(self, chat_id, message_id, text, buttons=None) -> None:
        self.net.wait()


def make_voice(phrases: list[str], audio_dir: Path) -> None:
    """Голосовые синтезирует espeak-ng: звучит роботом, но Whisper работает так же долго."""
    for i, text in enumerate(phrases):
        wav = audio_dir / f"{i}.wav"
        subprocess.run(["espeak-ng", "-v", "ru", "-s", "150", "-w", str(wav), text], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libopus",
                        str(audio_dir / f"{i}.ogg")], check=True)
        wav.unlink()


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))] if xs else 0.0


def run(n: int, lanes: int, voice_share: float, users: int, pipeline: Pipeline, store: MemoryStore,
        tg: MemoryTelegram) -> dict:
    store.rows.clear()
    voice_every = round(1 / voice_share) if voice_share else 0
    for i in range(n):
        voice = voice_every and i % voice_every == 0
        k = i % len(PHRASES)
        store.add(InboxRow(id=f"m{i}", user_id=f"u{i % users}", source="voice" if voice else "text",
                           text=None if voice else PHRASES[k], audio_ref=f"storage:{k}.ogg" if voice else None,
                           attempts=0, reply_chat_id=1))

    stop = threading.Event()

    def step_for(_):
        def step(last_beat):
            row = store.claim()
            if row is None:
                with store.lock:
                    if all(r["status"] != "pending" for r in store.rows.values()):
                        stop.set()
                time.sleep(0.05)
                return last_beat
            run_one(row, pipeline, store, tg)
            return last_beat
        return step

    started = time.monotonic()
    run_lanes(lanes, stop, step_for)
    wall = time.monotonic() - started
    rows = list(store.rows.values())
    waits = [r["claimed"] - r["created"] for r in rows]
    total = [r["finished"] - r["created"] for r in rows]
    work = [r["finished"] - r["claimed"] for r in rows]
    return {"lanes": lanes, "wall": wall, "per_min": n / wall * 60, "work_p50": statistics.median(work),
            "wait_p50": statistics.median(waits), "total_p50": statistics.median(total),
            "total_p95": pct(total, 0.95), "failed": sum(r["status"] == "failed" for r in rows)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", "--messages", type=int, default=60)
    ap.add_argument("--lanes", default="1,2,3")
    ap.add_argument("--voice", type=float, default=0.25, help="доля голосовых, 0–1")
    ap.add_argument("--users", type=int, default=30)
    ap.add_argument("--net-ms", type=float, default=140, help="задержка одного вызова Supabase/Telegram")
    ap.add_argument("--model", default="qwen3:8b")
    ap.add_argument("--ollama", default="http://localhost:11434")
    ap.add_argument("--whisper-device", default="auto", choices=["auto", "cuda", "cpu"])
    args = ap.parse_args()

    http = httpx.Client()
    net = Net(args.net_ms)
    with tempfile.TemporaryDirectory() as tmp:
        audio_dir = Path(tmp) / "audio"
        audio_dir.mkdir()
        if args.voice:
            make_voice(PHRASES, audio_dir)
        store, tg = MemoryStore(net, audio_dir), MemoryTelegram(net)
        stt = Transcriber(FASTER_DEFAULT, backend="faster", device=args.whisper_device)
        pipeline = Pipeline(store=store, tg=tg, stt=stt, extractor=Extractor(OllamaClient(args.ollama, args.model, http)),
                            classifier=None, fetch_rates=lambda: RATES, threshold=0.7, tmp_dir=Path(tmp) / "work")
        if args.voice:
            stt.warm_up()
        http.post(f"{args.ollama}/api/generate", json={"model": args.model}, timeout=180).raise_for_status()

        print(f"{args.messages} сообщений от {args.users} человек, голосовых {args.voice:.0%}, "
              f"сеть {args.net_ms:.0f} мс, {args.model}, whisper: {stt.device or args.whisper_device}\n")
        print("потоков | всё за, с | сообщ/мин | разбор p50 | ожидание p50 | ответ p50 | ответ p95 | ошибок")
        for lanes in [int(x) for x in args.lanes.split(",")]:
            r = run(args.messages, lanes, args.voice, args.users, pipeline, store, tg)
            print(f"{r['lanes']:7} | {r['wall']:9.0f} | {r['per_min']:9.1f} | {r['work_p50']:9.1f}с | "
                  f"{r['wait_p50']:11.0f}с | {r['total_p50']:8.0f}с | {r['total_p95']:8.0f}с | {r['failed']:6}")


if __name__ == "__main__":
    main()
