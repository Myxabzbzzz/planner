import plistlib
import subprocess
import uuid
from pathlib import Path

CAPTURE_PATH = "/functions/v1/capture"


def _txt(s: str) -> dict:
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}


def _ref(output_uuid: str, name: str) -> dict:
    return {"Value": {"string": "￼", "attachmentsByRange": {
        "{0, 1}": {"OutputUUID": output_uuid, "OutputName": name, "Type": "ActionOutput"}}},
        "WFSerializationType": "WFTextTokenString"}


def _dict(items: list[tuple[str, dict]]) -> dict:
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": _txt(k), "WFValue": v} for k, v in items]},
        "WFSerializationType": "WFDictionaryFieldValue"}


def build_shortcut(supabase_url: str, token: str) -> bytes:
    """Команда «Планер»: диктовка → POST в capture → значение message → уведомление."""
    dictate, post, getv = (str(uuid.uuid4()).upper() for _ in range(3))
    actions = [
        {"WFWorkflowActionIdentifier": "is.workflow.actions.dictatetext",
         "WFWorkflowActionParameters": {"UUID": dictate, "WFSpeechLanguage": "ru-RU",
                                        "WFDictateTextStopListening": "After Pause"}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.downloadurl",
         "WFWorkflowActionParameters": {
             "UUID": post, "WFURL": supabase_url.rstrip("/") + CAPTURE_PATH, "WFHTTPMethod": "POST",
             "ShowHeaders": True, "WFHTTPHeaders": _dict([("Authorization", _txt(f"Bearer {token}"))]),
             "WFHTTPBodyType": "JSON", "WFJSONValues": _dict([("text", _ref(dictate, "Dictated Text"))])}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.getvalueforkey",
         "WFWorkflowActionParameters": {
             "UUID": getv, "WFDictionaryKey": "message",
             "WFInput": {"Value": {"OutputUUID": post, "OutputName": "Contents of URL", "Type": "ActionOutput"},
                         "WFSerializationType": "WFTextTokenAttachment"}}},
        {"WFWorkflowActionIdentifier": "is.workflow.actions.notification",
         "WFWorkflowActionParameters": {"WFNotificationActionTitle": "Планер",
                                        "WFNotificationActionBody": _ref(getv, "Dictionary Value"),
                                        "WFNotificationActionSound": True}},
    ]
    workflow = {
        "WFWorkflowActions": actions,
        "WFWorkflowClientVersion": "2607.0.5",
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59511},
        "WFWorkflowImportQuestions": [],
        "WFWorkflowTypes": [],
        "WFWorkflowInputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowHasShortcutInputVariables": False,
    }
    return plistlib.dumps(workflow, fmt=plistlib.FMT_BINARY)


class ShortcutSignError(RuntimeError):
    """Текст — наш и вывод `shortcuts`, токена в нём нет: его можно логировать целиком."""


class ShortcutSigner:
    def __init__(self, run=subprocess.run):
        self.run = run

    def sign(self, unsigned: Path, signed: Path) -> None:
        r = self.run(["/usr/bin/shortcuts", "sign", "--mode", "anyone", "--input", str(unsigned),
                      "--output", str(signed)], capture_output=True, timeout=120)
        if r.returncode != 0 or not signed.exists():
            why = (getattr(r, "stderr", None) or b"").decode(errors="replace").strip().splitlines()
            raise ShortcutSignError(f"shortcuts sign failed ({r.returncode}): {why[-1][:200] if why else 'no output'}")
