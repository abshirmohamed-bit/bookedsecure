from unittest.mock import patch

from sqlmodel import select

from app import media
from app.config import settings
from app.db import session
from app.ids import new_id
from app.models import Asset, ImportTask
from app.pipeline import imports


def test_ffmpeg_bounds_each_input_and_output():
    with patch("app.media.run") as run, patch("app.media._bin", return_value="ffmpeg"):
        media.ffmpeg(["-i", "one.mp4", "-i", "two.mp4", "-c:v", "libx264", "out.mp4"])
    args = run.call_args.args[0]
    # The bound follows the machine's cores (2 on Fly), so read it rather than
    # assume it: a hardcoded "2" fails on any larger test machine.
    threads = str(settings().worker_threads())
    assert args[args.index("-filter_threads") + 1] == threads
    assert args[args.index("-filter_complex_threads") + 1] == threads
    assert args.count("-threads") == 3
    for i, arg in enumerate(args):
        if arg == "-i":
            assert args[i - 2:i] == ["-threads", threads]
    assert args[-3:] == ["-threads", threads, "out.mp4"]


def test_av1_import_retains_video_without_full_frame_encode():
    from pathlib import Path
    with patch("app.media.ffmpeg") as ffmpeg:
        media.remux_av1(Path("source.mp4"), Path("normalized.mp4"))
    args = ffmpeg.call_args.args[0]
    assert args[args.index("-c:v") + 1] == "copy"
    assert args[args.index("-c:a") + 1] == "aac"
    assert "-vf" not in args
    assert "-r" not in args


def test_import_returns_before_processing_and_recovers(api):
    url = "https://youtu.be/queue-test"
    with patch("app.pipeline.ingest.import_url") as ingest:
        response = api.post("/v1/assets", json={"url": url, "rights_confirmed": True})
        assert response.status_code == 200
        asset_id = response.json()["id"]
        assert response.json()["status"] == "importing"
        ingest.assert_not_called()
        assert api.post("/v1/assets", json={"url": url, "rights_confirmed": True}).json()["id"] == asset_id
    with session() as s:
        task = s.get(ImportTask, asset_id)
        task.status = "processing"
        s.add(task)
        s.commit()
    imports.recover()
    with session() as s:
        assert s.get(ImportTask, asset_id).status == "queued"
    def ready(s, asset, url, **_):
        asset.status = "ready"
        s.add(asset)
        s.commit()
    with patch("app.pipeline.ingest.import_url", side_effect=ready):
        assert imports.advance_one()
        assert not imports.advance_one()
    with session() as s:
        assert s.get(ImportTask, asset_id).status == "completed"
        assert s.get(Asset, asset_id).status == "ready"


def test_recovery_has_attempt_budget(api):
    asset_id = new_id("ast")
    with session() as s:
        s.add(Asset(id=asset_id, source_url="https://youtu.be/interrupted"))
        s.add(ImportTask(asset_id=asset_id, attempts=3, status="processing"))
        s.commit()
    imports.recover()
    assert imports.advance_one()
    with session() as s:
        assert s.get(Asset, asset_id).status == "failed"
        assert s.get(ImportTask, asset_id).status == "failed"


def test_rights_required_before_queue(api):
    response = api.post("/v1/assets", json={"url": "https://youtu.be/no-rights"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "RIGHTS_REQUIRED"
    with session() as s:
        assert not s.exec(select(Asset).where(Asset.source_url == "https://youtu.be/no-rights")).first()

def test_pasting_a_link_again_reuses_the_whole_video_not_one_of_its_sections(api):
    """Seen live: after a lean run cut 20 HD sections (which carry the same
    link), pasting the 58-minute video again returned the newest 82 s section,
    and the new clip job found 2 clips in it instead of ~20 in the video."""
    url = "https://youtu.be/sections-share-my-link"
    with session() as s:
        s.add(Asset(id="ast_whole", source_url=url, status="ready", category="asset"))
        s.commit()
        s.add(Asset(id="ast_section", source_url=url, status="ready", category="section",
                    parent_id="ast_whole", offset_ms=1655304))
        s.commit()
    assert api.post("/v1/assets", json={"url": url, "rights_confirmed": True}).json()["id"] == "ast_whole"
