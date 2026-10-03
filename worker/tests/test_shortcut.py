import plistlib
from pathlib import Path
from types import SimpleNamespace

import pytest

from planner_worker.shortcut import ShortcutSigner, build_shortcut

TOKEN = "a" * 64


def test_build_shortcut_actions_and_values():
    wf = plistlib.loads(build_shortcut("https://x.supabase.co/", TOKEN))
    acts = wf["WFWorkflowActions"]
    assert [a["WFWorkflowActionIdentifier"] for a in acts] == [
        "is.workflow.actions.dictatetext", "is.workflow.actions.downloadurl",
        "is.workflow.actions.getvalueforkey", "is.workflow.actions.notification"]
    dictate, post, getv, notify = (a["WFWorkflowActionParameters"] for a in acts)
    assert dictate["WFSpeechLanguage"] == "ru-RU"
    assert post["WFURL"] == "https://x.supabase.co/functions/v1/capture"
    assert post["WFHTTPMethod"] == "POST" and post["WFHTTPBodyType"] == "JSON"
    header = post["WFHTTPHeaders"]["Value"]["WFDictionaryFieldValueItems"][0]
    assert header["WFKey"]["Value"]["string"] == "Authorization"
    assert header["WFValue"]["Value"]["string"] == f"Bearer {TOKEN}"
    body = post["WFJSONValues"]["Value"]["WFDictionaryFieldValueItems"][0]
    assert body["WFKey"]["Value"]["string"] == "text"
    assert body["WFValue"]["Value"]["attachmentsByRange"]["{0, 1}"]["OutputUUID"] == dictate["UUID"]
    assert getv["WFDictionaryKey"] == "message"
    assert getv["WFInput"]["Value"]["OutputUUID"] == post["UUID"]
    assert notify["WFNotificationActionBody"]["Value"]["attachmentsByRange"]["{0, 1}"]["OutputUUID"] == getv["UUID"]


def test_signer_calls_shortcuts_cli(tmp_path):
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        Path(cmd[cmd.index("--output") + 1]).write_bytes(b"signed")
        return SimpleNamespace(returncode=0)

    ShortcutSigner(run).sign(tmp_path / "u.shortcut", tmp_path / "s.shortcut")
    assert calls[0][:4] == ["/usr/bin/shortcuts", "sign", "--mode", "anyone"]


def test_signer_raises_on_failure(tmp_path):
    with pytest.raises(RuntimeError):
        ShortcutSigner(lambda cmd, **kw: SimpleNamespace(returncode=1)).sign(tmp_path / "u", tmp_path / "s")
