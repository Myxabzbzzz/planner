from pathlib import Path


class Transcriber:
    def __init__(self, model_repo: str):
        self.model_repo = model_repo

    def transcribe(self, path: Path) -> str:
        import mlx_whisper

        out = mlx_whisper.transcribe(str(path), path_or_hf_repo=self.model_repo, language="ru")
        return (out.get("text") or "").strip()
