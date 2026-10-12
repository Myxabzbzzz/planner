from planner_worker import config


def _env(monkeypatch, **extra):
    monkeypatch.setattr(config, "load_dotenv", lambda: None)
    for k in ("WHISPER_BACKEND", "WHISPER_MODEL", "WORKER_INBOX", "OLLAMA_KEEP_ALIVE"):
        monkeypatch.delenv(k, raising=False)
    for k, v in {"SUPABASE_URL": "u", "SUPABASE_SERVICE_ROLE_KEY": "k", "TELEGRAM_BOT_TOKEN": "t", **extra}.items():
        monkeypatch.setenv(k, v)


def test_linux_gets_faster_whisper_even_with_a_mac_env(monkeypatch):
    _env(monkeypatch, WHISPER_MODEL="mlx-community/whisper-large-v3-turbo")
    monkeypatch.setattr(config, "default_backend", lambda: "faster")
    c = config.load_config()
    assert (c.whisper_backend, c.whisper_model, c.inbox) == ("faster", "large-v3-turbo", True)


def test_mac_jobs_only(monkeypatch):
    _env(monkeypatch, WORKER_INBOX="false")
    monkeypatch.setattr(config, "default_backend", lambda: "mlx")
    c = config.load_config()
    assert (c.whisper_backend, c.whisper_model, c.inbox) == ("mlx", "mlx-community/whisper-large-v3-turbo", False)


def test_keep_alive_forever_on_server_30m_on_mac():
    assert config.keep_alive(None, "linux") == -1
    assert config.keep_alive("", "darwin") == "30m"
    assert config.keep_alive("-1", "darwin") == -1
    assert config.keep_alive("1h", "linux") == "1h"
