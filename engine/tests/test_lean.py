"""Lean imports: audio first, then only the video around each chosen moment."""
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.pipeline import lean


def test_sections_pad_each_moment_and_stay_inside_the_video():
    plan = lean.plan_sections([(5_000, 30_000), (590_000, 600_000)], 600_000, pad_ms=10_000)
    assert [(p.index, p.start_ms, p.end_ms) for p in plan] == [(0, 0, 40_000), (1, 580_000, 600_000)]


def test_rebase_keeps_only_what_is_inside_and_moves_it_to_zero():
    words = [{"start_ms": 900, "end_ms": 1000, "text": "before"},
             {"start_ms": 1500, "end_ms": 1800, "text": "in"},
             {"start_ms": 5200, "end_ms": 5400, "text": "after"}]
    sentences = [{"start_ms": 1400, "end_ms": 2000, "text": "in", "words": words}]
    assert [w["text"] for w in lean.rebase(words, 1000, 1000, 5000)] == ["in"]
    moved = lean.rebase(sentences, 1000, 1000, 5000)[0]
    assert (moved["start_ms"], moved["end_ms"]) == (400, 1000)
    assert [(w["text"], w["start_ms"]) for w in moved["words"]] == [("in", 500)]


def test_best_lag_finds_a_probe_inside_its_window():
    rng = np.random.default_rng(7)
    window = rng.normal(size=8000 * 40).astype(np.float32)
    probe = window[12_345:12_345 + 8000 * 10].copy()
    lag, score = lean.best_lag(window, probe)
    assert lag == 12_345 and score > 0.99


def test_best_lag_does_not_match_a_different_recording():
    rng = np.random.default_rng(8)
    window = rng.normal(size=8000 * 40).astype(np.float32)
    other = rng.normal(size=8000 * 10).astype(np.float32)
    assert lean.best_lag(window, other)[1] < lean.MIN_SCORE


@pytest.fixture(scope="module")
def long_talk(tmp_path_factory) -> Path:
    """90s of video whose sound never repeats, so a cut can be placed exactly."""
    out = tmp_path_factory.mktemp("lean") / "long.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=0x202030:s=640x360:r=25:d=90",
        "-f", "lavfi", "-i", "anoisesrc=d=90:c=pink:seed=42:a=0.3",
        "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-g", "125", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", str(out)], check=True)
    return out


def _audio_of(src: Path, dest: Path) -> Path:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-vn",
                    "-c:a", "copy", str(dest)], check=True)
    return dest


def _cut_like_a_stream(src: Path, dest: Path, start_ms: int, end_ms: int) -> None:
    """What a section download does: stream copy, so it starts on a keyframe, not where asked."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start_ms / 1000:.3f}",
                    "-i", str(src), "-t", f"{(end_ms - start_ms) / 1000:.3f}", "-c", "copy",
                    "-avoid_negative_ts", "make_zero", str(dest)], check=True)


def test_measure_offset_places_a_reencoded_cut_to_the_millisecond(long_talk, tmp_path):
    full = _audio_of(long_talk, tmp_path / "full.m4a")
    section = tmp_path / "section.mp4"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", "33.4", "-i", str(long_talk),
                    "-t", "20", "-c:v", "libx264", "-c:a", "aac", str(section)], check=True)
    found = lean.measure_offset(full, section, asked_ms=30_000)
    assert abs(found - 33_400) <= 40


def test_a_long_link_is_clipped_from_sections_with_exact_captions(api, long_talk, tmp_path, monkeypatch):
    from app import storage
    from app.config import settings
    from app.db import session
    from app.ids import new_id
    from app.models import Asset, Project
    from app.pipeline import ingest
    from app import worker

    audio_key = "sources/lean-test/audio.m4a"
    _audio_of(long_talk, storage.open_write(audio_key))
    with session() as s:
        asset = Asset(id=new_id("ast"), name="Long talk", type="video", status="ready", lean=True,
                      storage_key=audio_key, mezzanine_key=audio_key, length_s=90.0,
                      source_url="https://www.youtube.com/watch?v=lean-test", rights_confirmed=True)
        s.add(asset)
        s.commit()
        asset_id = asset.id

    asked = []

    def fake_section(url, dest, start_ms, end_ms):
        asked.append((start_ms, end_ms))
        _cut_like_a_stream(long_talk, dest, start_ms, end_ms)

    monkeypatch.setattr(ingest, "fetch_section", fake_section)
    monkeypatch.setattr(settings(), "section_pad_ms", 3000)

    job_id = api.post("/v1/autoclip", json={
        "asset_id": asset_id, "clip_count": 2, "clip_length": 8, "aspect": "9:16", "formats": ["full-video"],
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
    assert "fetching" in seen
    assert len(asked) == 2                      # only the chosen moments were downloaded

    with session() as s:
        for clip in job["clips"]:
            p = s.get(Project, clip["project_id"])
            section = s.get(Asset, p.asset_id)
            assert section.parent_id == asset_id and section.category == "section"
            # the section's sound at 1s is found, independently, at offset + 1s: captions line up
            here = lean._pcm(storage.local_path(section.storage_key), 1.0, 3.0)
            look_from = max(0, section.offset_ms - 5000)
            lag, _ = lean.best_lag(lean._pcm(storage.local_path(audio_key), look_from / 1000, 20.0), here)
            assert abs(look_from + lag * 1000 / lean.MATCH_RATE - (section.offset_ms + 1000)) <= 30
            # the clip sits where the finder put it in the original video
            assert clip["source_start_ms"] == p.in_ms + section.offset_ms
            assert 0 <= p.in_ms < p.out_ms <= section.length_s * 1000 + 1
            # captions are timed from the clip's own start
            assert all(0 <= w["start_ms"] <= p.out_ms - p.in_ms + 50 for w in p.captions)

    # a trim can't run past the video that was fetched
    clip = job["clips"][0]
    project = api.get(f"/v1/projects/{clip['project_id']}").json()
    assert project["source_length_ms"] > 0
    too_far = api.patch(f"/v1/projects/{clip['project_id']}", json={"out_ms": project["source_length_ms"] + 5000})
    assert too_far.status_code == 422 or too_far.json().get("error")


def test_sections_that_fail_are_cut_from_one_whole_download(api, long_talk, tmp_path, monkeypatch):
    from app import storage, worker
    from app.config import settings
    from app.db import session
    from app.ids import new_id
    from app.models import Asset, Project
    from app.pipeline import ingest

    audio_key = "sources/lean-fallback/audio.m4a"
    _audio_of(long_talk, storage.open_write(audio_key))
    with session() as s:
        asset = Asset(id=new_id("ast"), name="Long talk 2", type="video", status="ready", lean=True,
                      storage_key=audio_key, mezzanine_key=audio_key, length_s=90.0,
                      source_url="https://www.youtube.com/watch?v=lean-fallback", rights_confirmed=True)
        s.add(asset)
        s.commit()
        asset_id = asset.id
    whole_downloads = []

    def refused(url, dest, start_ms, end_ms):
        raise RuntimeError("ERROR: ffmpeg exited with code 8")

    def whole(url, dest, on_progress=None):
        whole_downloads.append(url)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(long_talk.read_bytes())

    monkeypatch.setattr(ingest, "fetch_section", refused)
    monkeypatch.setattr(ingest, "download_whole", whole)
    monkeypatch.setattr(settings(), "section_pad_ms", 3000)
    job_id = api.post("/v1/autoclip", json={
        "asset_id": asset_id, "clip_count": 2, "clip_length": 8, "aspect": "9:16", "formats": ["full-video"],
    }).json()["id"]
    for _ in range(40):
        worker.tick()
        job = api.get(f"/v1/autoclip/{job_id}").json()
        if job["status"] in {"completed", "failed"}:
            break
    assert job["status"] == "completed", job.get("error")
    assert whole_downloads == ["https://www.youtube.com/watch?v=lean-fallback"]   # once, for every section
    with session() as s:
        for clip in job["clips"]:
            section = s.get(Asset, s.get(Project, clip["project_id"]).asset_id)
            assert section.parent_id == asset_id and lean.has_video(storage.local_path(section.storage_key))


def test_an_audio_only_download_does_not_count_as_a_section(long_talk, tmp_path):
    sound = _audio_of(long_talk, tmp_path / "sound.m4a")
    assert not lean.has_video(sound)
    assert lean.has_video(long_talk)


def test_an_existing_database_gains_the_new_columns(tmp_path):
    import sqlite3

    from app import db

    path = tmp_path / "old.db"
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE assets (id VARCHAR PRIMARY KEY, name VARCHAR)")
    con.commit()
    con.close()
    from sqlalchemy import create_engine

    eng = create_engine(f"sqlite:///{path}")
    db._add_missing_columns(eng)
    with eng.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(assets)")}
    assert {"lean", "parent_id", "offset_ms"} <= cols


def test_download_progress_is_read_as_it_comes(tmp_path):
    import sys
    from app.pipeline.ingest import _run_with_progress

    script = tmp_path / "fake_ytdlp.py"
    script.write_text(
        "import sys\n"
        "for p in (10, 50, 100, 20, 100):\n"
        "    print(f'[download]  {p}.0% of 10.00MiB', flush=True)\n"
    )
    seen = []
    proc = _run_with_progress([sys.executable, str(script)], 60, seen.append)
    assert proc.returncode == 0
    # the picture counts for 90% of the bar, the sound for the rest
    assert [round(x, 3) for x in seen[:3]] == [0.09, 0.45, 0.9]
    assert seen[-1] == 1.0


def test_progress_only_moves_forward(api):
    from app.db import session
    from app.ids import new_id
    from app.models import Asset, Job
    from app.pipeline.jobs import _progress_reporter

    with session() as s:
        a = Asset(id=new_id("ast"), name="p", status="ready")
        j = Job(id=new_id("job"), asset_id=a.id, status="processing", stage="fetching", progress=35)
        s.add(a)
        s.add(j)
        s.commit()
        job_id = j.id
    report = _progress_reporter(job_id, 35, 82)
    report(0.5)
    report(0.2)          # a later, smaller reading never moves it back
    with session() as s:
        assert s.get(Job, job_id).progress == 58
