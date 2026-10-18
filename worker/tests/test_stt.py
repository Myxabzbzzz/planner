import sys
import types
from pathlib import Path
from types import SimpleNamespace

from planner_worker.stt import Transcriber, model_for


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


class FakeFaster:
    def __init__(self, device, fail=False):
        self.device, self.fail, self.calls = device, fail, []

    def transcribe(self, audio, language):
        self.calls.append((audio if isinstance(audio, str) else "array", language))
        if self.fail:
            raise RuntimeError("Library libcudnn_ops.so.9 is not found")
        return iter([SimpleNamespace(text=" кофе "), SimpleNamespace(text="сорок тысяч ")]), None


def test_faster_whisper_joins_segments_on_gpu():
    made = []
    t = Transcriber("large-v3-turbo", backend="faster",
                    load_faster=lambda name, device: made.append((name, device)) or FakeFaster(device))
    assert t.transcribe(Path("/tmp/a.oga")) == "кофе сорок тысяч"
    assert made == [("large-v3-turbo", "cuda")]


def test_faster_whisper_falls_back_to_cpu_when_cuda_libs_are_missing():
    made = []

    def load(name, device):
        made.append(device)
        return FakeFaster(device, fail=device == "cuda")

    t = Transcriber("large-v3-turbo", backend="faster", load_faster=load)
    t.warm_up()
    assert t.transcribe(Path("/tmp/a.oga")) == "кофе сорок тысяч"
    assert made == ["cuda", "cpu"], "на CPU переходим один раз и дальше там и остаёмся"


def test_model_name_follows_the_backend():
    assert model_for("mlx", None) == "mlx-community/whisper-large-v3-turbo"
    assert model_for("faster", None) == "large-v3-turbo"
    # .env, перенесённый с Mac, не ломает Linux
    assert model_for("faster", "mlx-community/whisper-large-v3-turbo") == "large-v3-turbo"
    assert model_for("faster", "medium") == "medium"


def test_faster_whisper_uses_cpu_when_cuda_is_not_compiled_in():
    made = []

    def load(name, device):
        made.append(device)
        if device == "cuda":
            raise ValueError("This CTranslate2 package was not compiled with CUDA support")
        return FakeFaster(device)

    t = Transcriber("large-v3-turbo", backend="faster", load_faster=load)
    assert t.transcribe(Path("/tmp/a.oga")) == "кофе сорок тысяч"
    assert made == ["cuda", "cpu"]


def test_threads_transcribe_one_at_a_time():
    import threading
    import time

    inside, peak = [0], [0]

    class Slow:
        def transcribe(self, audio, language):
            inside[0] += 1
            peak[0] = max(peak[0], inside[0])
            time.sleep(0.02)
            inside[0] -= 1
            return [], None

    t = Transcriber("large-v3-turbo", backend="faster", load_faster=lambda name, device: Slow())
    threads = [threading.Thread(target=t.transcribe, args=(Path("/tmp/a.oga"),)) for _ in range(4)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert peak[0] == 1


def test_whisper_device_cpu_never_touches_the_gpu():
    made = []
    t = Transcriber("large-v3-turbo", backend="faster", device="cpu",
                    load_faster=lambda name, device: made.append(device) or FakeFaster(device))
    t.transcribe(Path("/tmp/a.oga"))
    assert made == ["cpu"] and t.device == "cpu"
