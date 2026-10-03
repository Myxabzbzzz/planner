import sys
import types
from pathlib import Path

from planner_worker.stt import Transcriber


def test_transcribe_calls_mlx_whisper(monkeypatch):
    calls = {}
    fake = types.ModuleType("mlx_whisper")

    def transcribe(path, path_or_hf_repo, language):
        calls.update(path=path, repo=path_or_hf_repo, language=language)
        return {"text": "  кофе сорок тысяч  "}

    fake.transcribe = transcribe
    monkeypatch.setitem(sys.modules, "mlx_whisper", fake)
    out = Transcriber("mlx-community/whisper-large-v3-turbo").transcribe(Path("/tmp/a.oga"))
    assert out == "кофе сорок тысяч"
    assert calls == {"path": "/tmp/a.oga", "repo": "mlx-community/whisper-large-v3-turbo", "language": "ru"}


def test_warm_up_resolves_local_model_and_loads_it(monkeypatch):
    calls = []
    fake = types.ModuleType("mlx_whisper")

    def transcribe(audio, path_or_hf_repo, language):
        calls.append((type(audio).__name__, path_or_hf_repo))
        return {"text": ""}

    fake.transcribe = transcribe
    monkeypatch.setitem(sys.modules, "mlx_whisper", fake)
    t = Transcriber("mlx-community/whisper-large-v3-turbo", download=lambda repo: f"/cache/{repo}")
    t.warm_up()
    t.transcribe(Path("/tmp/a.oga"))
    assert calls == [("ndarray", "/cache/mlx-community/whisper-large-v3-turbo"),
                     ("str", "/cache/mlx-community/whisper-large-v3-turbo")]
