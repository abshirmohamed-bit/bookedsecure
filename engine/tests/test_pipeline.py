"""The whole job: a real video in, real rendered clips out.

Nothing here is stubbed except speech recognition and the language model, which
are swapped for deterministic providers so the test needs no weights or keys.
"""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

from app import worker
from app.config import settings
import pytest


def probe(path: Path) -> dict:
    import json

    out = subprocess.run(["ffprobe", "-v", "quiet", "-print_format", "json",
                          "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    return {"w": v["width"], "h": v["height"], "dur": float(data["format"]["duration"]),
            "vcodec": v["codec_name"],
            "has_audio": any(s["codec_type"] == "audio" for s in data["streams"])}


def test_upload_probes_the_real_file(api, uploaded_asset):
    asset = api.get(f"/v1/assets/{uploaded_asset}").json()
    assert asset["status"] == "ready"
    assert (asset["width"], asset["height"]) == (1280, 720)
    assert 19 < asset["length"] < 21
    assert asset["thumbnail_url"].endswith(".jpg")
    # a 720p source cannot fill a 1080x1920 crop, and the app is told so
    assert asset["quality_warning"] is True


def test_transcript_has_word_level_timings(api, uploaded_asset):
    t = api.post("/v1/transcripts", json={"asset_id": uploaded_asset}).json()
    assert t["status"] == "ready"
    words = t["words"]
    assert len(words) > 20
    assert all(w["start_ms"] < w["end_ms"] for w in words)
    assert all(words[i]["start_ms"] <= words[i + 1]["start_ms"] for i in range(len(words) - 1))
    assert len(t["sentences"]) >= 3


def test_job_runs_through_its_stages_and_finds_clips(api, uploaded_asset):
    job_id = api.post("/v1/autoclip", json={
        "asset_id": uploaded_asset, "clip_count": 3, "clip_length": 6,
        "aspect": "9:16", "formats": ["full-video"], "caption_style_id": "karaoke_highlight",
    }).json()["id"]

    seen = []
    for _ in range(40):
        worker.tick()
        job = api.get(f"/v1/autoclip/{job_id}").json()
        if job["stage"]:
            seen.append(job["stage"])
        if job["status"] in {"completed", "failed"}:
            break
    assert job["status"] == "completed", job.get("error")
    assert "transcribing" in seen and "finding" in seen and "cutting" in seen

    clips = job["clips"]
    assert len(clips) == 3
    for c in clips:
        assert c["end_ms"] > c["start_ms"]
        assert c["title"]
        assert 0 <= c["score"] <= 100
        assert set(c["grades"]) == {"hook", "flow", "value", "trend"}
        assert c["thumbnail_url"]
    # clips never overlap
    ordered = sorted(clips, key=lambda c: c["start_ms"])
    assert all(a["end_ms"] <= b["start_ms"] for a, b in zip(ordered, ordered[1:]))


def test_clip_carries_the_words_that_were_spoken_in_it(api, uploaded_asset):
    job = api.get("/v1/autoclip").json()["autoclips"][0]
    project_id = job["clips"][0]["project_id"]
    p = api.get(f"/v1/projects/{project_id}").json()
    assert p["captions"], "a clip should arrive with its own words"
    assert p["captions"][0]["start_ms"] < p["duration_ms"]
    # captions are re-based to the clip, not the source
    assert max(w["end_ms"] for w in p["captions"]) <= p["duration_ms"] + 1500


def test_export_produces_a_real_vertical_mp4(api, uploaded_asset):
    job = api.get("/v1/autoclip").json()["autoclips"][0]
    project_id = job["clips"][0]["project_id"]
    api.patch(f"/v1/projects/{project_id}", json={
        "title": {"text": "The honest answer", "style": "bold_band"},
        "watermark": {"text": "@crayzmundo", "position": "bottom-right", "opacity": 0.5},
    })
    export_id = api.post(f"/v1/projects/{project_id}/export", json={}).json()["id"]

    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        worker.tick()
        got = api.get(f"/v1/exports/{export_id}").json()
        if got["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert got["status"] == "completed", got.get("error")

    key = f"exports/{export_id}.mp4"
    path = settings().media_root / key
    assert path.exists(), "the rendered file is on disk"
    info = probe(path)
    assert (info["w"], info["h"]) == (1080, 1920), "a real vertical render"
    assert info["vcodec"] == "h264" and info["has_audio"]
    assert info["dur"] > 1
    assert got["asset"]["url"].endswith(".mp4")


def test_trim_moves_the_captions_with_the_clip(api):
    job = api.get("/v1/autoclip").json()["autoclips"][0]
    project_id = job["clips"][-1]["project_id"]
    before = api.get(f"/v1/projects/{project_id}").json()
    moved = api.patch(f"/v1/projects/{project_id}", json={
        "in_ms": before["in_ms"] + 1000, "out_ms": before["out_ms"]}).json()
    assert moved["duration_ms"] == before["duration_ms"] - 1000
    assert moved["captions"] != before["captions"], "words follow the new in point"


def test_captions_download_as_srt(api):
    job = api.get("/v1/autoclip").json()["autoclips"][0]
    project_id = job["clips"][0]["project_id"]
    body = api.get(f"/v1/projects/{project_id}/captions", params={"format": "srt"}).json()["body"]
    assert "-->" in body and body.strip().startswith("1")


def test_whole_video_coverage_leaves_nothing_out(api, uploaded_asset):
    job_id = api.post("/v1/autoclip", json={
        "asset_id": uploaded_asset, "coverage": "whole", "clip_length": 5, "clip_count": "auto",
    }).json()["id"]
    for _ in range(40):
        worker.tick()
        job = api.get(f"/v1/autoclip/{job_id}").json()
        if job["status"] in {"completed", "failed"}:
            break
    assert job["status"] == "completed", job.get("error")
    clips = sorted(job["clips"], key=lambda c: c["start_ms"])
    assert len(clips) >= 2
    covered = sum(c["duration_ms"] for c in clips)
    assert covered > 12_000, "most of a 20s source should be covered"
    assert all(a["end_ms"] <= b["start_ms"] for a, b in zip(clips, clips[1:]))


def test_auto_count_can_pause_for_confirmation(api, uploaded_asset):
    job_id = api.post("/v1/autoclip", json={
        "asset_id": uploaded_asset, "clip_count": "auto", "confirm_count": True, "clip_length": 6,
    }).json()["id"]
    for _ in range(20):
        worker.tick()
        job = api.get(f"/v1/autoclip/{job_id}").json()
        if job["status"] == "awaiting_confirmation":
            break
    assert job["status"] == "awaiting_confirmation"
    assert job["suggested_count"] and job["suggested_count"] > 0

    api.patch(f"/v1/autoclip/{job_id}", json={"clip_count": 2})
    for _ in range(40):
        worker.tick()
        job = api.get(f"/v1/autoclip/{job_id}").json()
        if job["status"] in {"completed", "failed"}:
            break
    assert job["status"] == "completed", job.get("error")
    assert len(job["clips"]) == 2


def _sentences(count: int, each_ms: int = 4000) -> list[dict]:
    words = ("the real question people keep asking is whether this actually changes anything "
             "because every number looks good until you compare it").split()
    return [{"start_ms": i * each_ms, "end_ms": i * each_ms + each_ms - 200,
             "text": " ".join(words[(i * 3) % len(words):][:7]) or "a sentence"}
            for i in range(count)]


@pytest.mark.parametrize("want", [3, 5, 10, 15, 20])
def test_asking_for_n_clips_returns_n_clips(want):
    """Snapping to sentence boundaries used to drop collisions and quietly return fewer."""
    from app.pipeline.find import find

    got = find(_sentences(360), count=want, target_ms=45_000, coverage="best")
    assert len(got) == want, f"asked for {want}, got {len(got)}"


def test_backfilled_clips_still_never_overlap():
    from app.pipeline.find import find

    got = find(_sentences(360), count=20, target_ms=45_000, coverage="best")
    for a, b in zip(got, got[1:]):
        assert a.end_ms <= b.start_ms, "clips must not overlap after backfilling"


def test_a_short_video_returns_what_actually_fits_rather_than_overlapping():
    """Two minutes cannot hold twenty 45s clips; returning fewer is correct."""
    from app.pipeline.find import find

    got = find(_sentences(30), count=20, target_ms=45_000, coverage="best")
    assert 0 < len(got) < 20
    for a, b in zip(got, got[1:]):
        assert a.end_ms <= b.start_ms


def test_auto_sparse_speech_falls_back_to_actual_audio_peaks(api, uploaded_asset, monkeypatch):
    from app.db import session
    from app.models import Asset, Job, Transcript
    from app.pipeline import jobs
    from app.ids import new_id

    envelope = [0.1] * 40
    envelope[6], envelope[18] = 1.0, 0.9
    monkeypatch.setattr(jobs.media, "loudness_envelope", lambda path: envelope)
    with session() as s:
        asset = s.get(Asset, uploaded_asset)
        assert asset is not None
        transcript = s.exec(__import__('sqlmodel').select(Transcript).where(Transcript.asset_id == asset.id)).first()
        assert transcript is not None
        transcript.sentences = [{"start_ms": 1000, "end_ms": 2000, "text": "Hello."}]
        s.add(transcript)
        s.commit()
        got = jobs._find(s, Job(id=new_id("job"), asset_id=asset.id), asset,
                        {"mode": "auto", "clip_length": 6, "clip_count": 2})
        assert got and len(got) == 2
        assert all(m.reason == "Audio peak." for m in got)
        assert all(0 <= m.start_ms < m.end_ms <= 20000 for m in got)


def test_finalizing_without_projects_is_not_success(api, uploaded_asset):
    from app.db import session
    from app.models import Job
    from app.pipeline import jobs
    from app.ids import new_id

    with session() as s:
        job = Job(id=new_id("job"), asset_id=uploaded_asset, status="processing", stage="finalizing")
        s.add(job)
        s.commit()
        with pytest.raises(RuntimeError, match="No usable moments"):
            jobs._step(s, job)
        assert job.status != "completed"


def test_the_finished_job_hands_over_everything_the_editor_needs(api, uploaded_asset):
    """The app should never ask a person to transcribe a clip twice.

    Everything here was computed while the source was being processed. If it
    does not travel with the finished job, the editor opens empty and offers
    to do the work again.
    """
    from sqlmodel import select

    from app.db import session
    from app.models import WebhookEvent

    with session() as s:
        events = s.exec(select(WebhookEvent).where(WebhookEvent.event == "autoclip.completed")).all()
        assert events, "a completed job should announce itself"
        clips = events[-1].data["clips"]

    assert clips, "the event should carry the clips"
    finish = clips[0]["finish"]
    assert finish["captions"], "the words the Engine already transcribed"
    assert {"text", "start_ms", "end_ms"} <= set(finish["captions"][0])
    assert finish["caption_style_id"], "a style to draw them in"
    assert finish["title_text"], "the hook the finder wrote"
    assert finish["title_style"]
    assert finish["aspect"] and finish["layout"]
    assert "framing" in finish and "watermark" in finish


def test_polling_a_running_job_stays_light(api, uploaded_asset):
    """The app polls this shape every second; the words do not belong in it."""
    jobs = api.get("/v1/autoclip").json()["autoclips"]
    job = next(j for j in jobs if j["clips"])
    assert "finish" not in job["clips"][0]
    assert job["clips"][0]["title"], "the summary still names the clip"


def test_a_preview_is_cut_once_and_then_reused(api, uploaded_asset):
    """Rendering runs inside the request, so cutting the same clip twice is
    CPU spent while the worker may be exporting that very clip."""
    job = next(j for j in api.get("/v1/autoclip").json()["autoclips"] if j["clips"])
    pid = job["clips"][0]["project_id"]

    first = api.post(f"/v1/projects/{pid}/preview").json()
    assert first["preview_url"], "a preview should be produced"

    from app.db import session
    from app.models import Project

    with session() as s:
        key = s.get(Project, pid).preview_key
    assert key, "the preview should be remembered"

    # Second ask: same URL, and nothing re-rendered.
    before = (settings_media() / key).stat().st_mtime_ns
    again = api.post(f"/v1/projects/{pid}/preview").json()
    assert again["preview_url"] == first["preview_url"]
    assert (settings_media() / key).stat().st_mtime_ns == before, "it re-rendered"


def test_editing_a_clip_throws_the_stale_preview_away(api, uploaded_asset):
    """A preview of the old settings would be a lie."""
    from app.db import session
    from app.models import Project

    job = next(j for j in api.get("/v1/autoclip").json()["autoclips"] if j["clips"])
    pid = job["clips"][0]["project_id"]
    api.post(f"/v1/projects/{pid}/preview")
    with session() as s:
        assert s.get(Project, pid).preview_key

    api.patch(f"/v1/projects/{pid}", json={"aspect": "1:1"})
    with session() as s:
        assert not s.get(Project, pid).preview_key, "an aspect change must clear it"


def settings_media():
    from app.config import settings

    return settings().media_root
