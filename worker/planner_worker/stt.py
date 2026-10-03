from pathlib import Path
from typing import Callable


def _snapshot(repo: str) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(repo)


class Transcriber:
    def __init__(self, model_repo: str, download: Callable[[str], str] = _snapshot):
        self.model_repo = model_repo
        self._download = download
        self._model: str = model_repo

    def warm_up(self) -> None:
        """Скачивает модель (если её нет), дальше работаем с локальной папкой без походов в сеть,
        и сразу грузит её в память, чтобы первое голосовое не ждало."""
        import numpy as np
        import mlx_whisper

        self._model = self._download(self.model_repo)
        mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=self._model, language="ru")

    def transcribe(self, path: Path) -> str:
        import mlx_whisper

        out = mlx_whisper.transcribe(str(path), path_or_hf_repo=self._model, language="ru")
        return (out.get("text") or "").strip()
