from unittest.mock import patch

from sqlmodel import select

from app import media
from app.db import session
from app.ids import new_id
from app.models import Asset, ImportTask
from app.pipeline import imports


def test_ffmpeg_bounds_each_input_and_output():
    with patch("app.media.run") as run, patch("app.media._bin", return_value="ffmpeg"):
        media.ffmpeg(["-i", "one.mp4", "-i", "two.mp4", "-c:v", "libx264", "out.mp4"])
    args = run.call_args.args[0]
    assert args[args.index("-filter_threads") + 1] == "2"
    assert args[args.index("-filter_complex_threads") + 1] == "2"
    assert args.count("-threads") == 3
    for i, arg in enumerate(args):
        if arg == "-i":
            assert args[i - 2:i] == ["-threads", "2"]
    assert args[-3:] == ["-threads", "2", "out.mp4"]


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
    def ready(s, asset, url):
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