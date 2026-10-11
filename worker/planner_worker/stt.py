import logging
import sys
from pathlib import Path
from typing import Callable

log = logging.getLogger(__name__)

MLX_DEFAULT = "mlx-community/whisper-large-v3-turbo"
FASTER_DEFAULT = "large-v3-turbo"


def default_backend() -> str:
    """mlx-whisper работает только на Mac с Apple Silicon; на Linux — faster-whisper (CUDA или CPU)."""
    return "mlx" if sys.platform == "darwin" else "faster"


def model_for(backend: str, configured: str | None) -> str:
    """Имя модели под движок. .env, перенесённый с Mac, указывает на mlx-модель —
    faster-whisper её не прочитает, поэтому берём ту же large-v3-turbo в его формате."""
    if backend == "faster":
        return FASTER_DEFAULT if not configured or configured.startswith("mlx-community/") else configured
    return configured or MLX_DEFAULT


def _snapshot(repo: str) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(repo)


def _faster_model(name: str, device: str):
    from faster_whisper import WhisperModel

    # int8_float16: на RTX 3050 тот же текст, а видеопамяти вдвое меньше (1,1 ГБ против 2,2) —
    # остаток нужен LLM, иначе её часть уходит на процессор
    return WhisperModel(name, device=device, compute_type="int8_float16" if device == "cuda" else "int8")


class Transcriber:
    def __init__(self, model_repo: str, download: Callable[[str], str] = _snapshot,
                 backend: str = "mlx", load_faster: Callable[[str, str], object] = _faster_model):
        self.model_repo = model_repo
        self.backend = backend
        self._download = download
        self._load_faster = load_faster
        self._model: str = model_repo
        self._faster = None
        self._device = ""

    def warm_up(self) -> None:
        """Скачивает модель (если её нет), дальше работаем с локальной папкой без походов в сеть,
        и сразу грузит её в память, чтобы первое голосовое не ждало."""
        import numpy as np

        if self.backend == "faster":
            self._faster_transcribe(np.zeros(16000, dtype=np.float32))
            return
        import mlx_whisper

        self._model = self._download(self.model_repo)
        mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=self._model, language="ru")

    def transcribe(self, path: Path) -> str:
        if self.backend == "faster":
            return self._faster_transcribe(str(path))
        import mlx_whisper

        out = mlx_whisper.transcribe(str(path), path_or_hf_repo=self._model, language="ru")
        return (out.get("text") or "").strip()

    def _use(self, device: str) -> None:
        self._faster = self._load_faster(self.model_repo, device)
        self._device = device

    def _run(self, audio) -> str:
        segments, _ = self._faster.transcribe(audio, language="ru")
        return " ".join(s.text.strip() for s in segments).strip()

    def _faster_transcribe(self, audio) -> str:
        # Видеокарта может отказать в двух местах: CTranslate2 собран без CUDA — падает уже
        # создание модели; нет библиотек cuBLAS/cuDNN — только первое распознавание.
        # В обоих случаях один раз переходим на процессор и дальше остаёмся там.
        if self._faster is None:
            try:
                self._use("cuda")
            except Exception as e:  # noqa: BLE001
                log.warning("whisper on GPU unavailable (%s), using CPU", e)
                self._use("cpu")
        try:
            return self._run(audio)
        except Exception as e:  # noqa: BLE001
            if self._device != "cuda":
                raise
            log.warning("whisper on GPU failed (%s), falling back to CPU", e)
            self._use("cpu")
            return self._run(audio)
