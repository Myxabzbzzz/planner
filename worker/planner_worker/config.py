import os
import re
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

from .stt import MLX_DEFAULT, default_backend, model_for


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_key: str
    telegram_bot_token: str
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:8b"
    # сколько Ollama держит модель в памяти после запроса; -1 — всегда
    ollama_keep_alive: str | int = "30m"
    whisper_model: str = MLX_DEFAULT
    whisper_backend: str = "mlx"
    use_laya: bool = True
    laya_threshold: float = 0.7
    worker_id: str = "laptop"
    poll_interval: float = 2.0
    # false — воркер не берёт сообщения, только подписывает быстрые команды (Mac рядом с сервером на Linux)
    inbox: bool = True


def keep_alive(value: str | None, platform: str = sys.platform) -> str | int:
    """Сервер на Linux держит модель всегда — иначе первое сообщение после простоя ждёт её загрузку;
    ноутбуку держать 6 ГБ без дела незачем. Число — секунды (как у Ollama), строка — длительность ("30m")."""
    if not value:
        return "30m" if platform == "darwin" else -1
    return int(value) if re.fullmatch(r"-?\d+", value) else value


def load_config() -> Config:
    load_dotenv()
    env = os.environ
    backend = env.get("WHISPER_BACKEND") or default_backend()
    return Config(
        supabase_url=env["SUPABASE_URL"],
        supabase_service_key=env["SUPABASE_SERVICE_ROLE_KEY"],
        telegram_bot_token=env["TELEGRAM_BOT_TOKEN"],
        ollama_url=env.get("OLLAMA_URL", Config.ollama_url),
        ollama_model=env.get("OLLAMA_MODEL", Config.ollama_model),
        ollama_keep_alive=keep_alive(env.get("OLLAMA_KEEP_ALIVE")),
        whisper_backend=backend,
        whisper_model=model_for(backend, env.get("WHISPER_MODEL")),
        use_laya=env.get("USE_LAYA", "true").lower() == "true",
        laya_threshold=float(env.get("LAYA_THRESHOLD", "0.7")),
        worker_id=env.get("WORKER_ID", "laptop"),
        poll_interval=float(env.get("POLL_INTERVAL", "2")),
        inbox=env.get("WORKER_INBOX", "true").lower() == "true",
    )
