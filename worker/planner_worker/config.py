import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_key: str
    telegram_bot_token: str
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:8b"
    whisper_model: str = "mlx-community/whisper-large-v3-turbo"
    use_laya: bool = True
    laya_threshold: float = 0.7
    worker_id: str = "laptop"
    poll_interval: float = 2.0


def load_config() -> Config:
    load_dotenv()
    env = os.environ
    return Config(
        supabase_url=env["SUPABASE_URL"],
        supabase_service_key=env["SUPABASE_SERVICE_ROLE_KEY"],
        telegram_bot_token=env["TELEGRAM_BOT_TOKEN"],
        ollama_url=env.get("OLLAMA_URL", Config.ollama_url),
        ollama_model=env.get("OLLAMA_MODEL", Config.ollama_model),
        whisper_model=env.get("WHISPER_MODEL", Config.whisper_model),
        use_laya=env.get("USE_LAYA", "true").lower() == "true",
        laya_threshold=float(env.get("LAYA_THRESHOLD", "0.7")),
        worker_id=env.get("WORKER_ID", "laptop"),
        poll_interval=float(env.get("POLL_INTERVAL", "2")),
    )
