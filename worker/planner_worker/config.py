import os
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
    whisper_model: str = MLX_DEFAULT
    whisper_backend: str = "mlx"
    use_laya: bool = True
    laya_threshold: float = 0.7
    worker_id: str = "laptop"
    poll_interval: float = 2.0
    # false — воркер не берёт сообщения, только подписывает быстрые команды (Mac рядом с сервером на Linux)
    inbox: bool = True


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
        whisper_backend=backend,
        whisper_model=model_for(backend, env.get("WHISPER_MODEL")),
        use_laya=env.get("USE_LAYA", "true").lower() == "true",
        laya_threshold=float(env.get("LAYA_THRESHOLD", "0.7")),
        worker_id=env.get("WORKER_ID", "laptop"),
        poll_interval=float(env.get("POLL_INTERVAL", "2")),
        inbox=env.get("WORKER_INBOX", "true").lower() == "true",
    )
