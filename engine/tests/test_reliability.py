"""Long audio, a full disk and failures that shouldn't end a job."""
import os
from datetime import datetime, timezone
import time
from pathlib import Path

from app import storage
from app.config import settings
from app.pipeline import find as finder
from app.pipeline import jobs as job_pipeline
from app.pipeline.transcribe import Word, merge_chunk_words, plan_chunks


def test_short_audio_is_one_piece():
    assert plan_chunks(600.0) == [(0.0, 600.0)]


def test_long_audio_is_covered_with_overlaps():
    plan = plan_chunks(10800.0)
    assert plan[0][0] == 0.0
    assert plan[-1][0] + plan[-1][1] == 10800.0
    for (a, a_len), (b, _) in zip(plan, plan[1:]):
        assert b < a + a_len


def test_chunks_merge_into_source_time_without_repeating_the_overlap():
    first = merge_chunk_words([], [Word(1000, 1500, "hello"), Word(1198500, 1199000, "again")], 0.0)
    merged = merge_chunk_words(first, [Word(100, 400, "again"), Word(2500, 3000, "world")], 1198.0)
    assert [w.text for w in merged] == ["hello", "again", "world"]
    assert merged[-1].start_ms == 1200500


def test_a_long_transcript_makes_one_request_per_piece(monkeypatch, tmp_path):
    from app.pipeline import transcribe as tr

    audio = tmp_path / "a.wav"
    audio.write_bytes(b"x")
    monkeypatch.setattr(tr, "_wav_seconds", lambda _: 3000.0)
    def encode(_, start, __):
        part = tmp_path / f"{int(start)}.ogg"
        part.write_bytes(b"x")
        return part
    monkeypatch.setattr(tr, "_encode_chunk", encode)
    calls = []
    def request(part, *_):
        calls.append(part)
        return tr.Transcription("en", "groq/x", [tr.Word(5000, 5500, "hi")], [])
    monkeypatch.setattr(tr, "_groq_request", request)
    out = tr._groq(audio, [], None)
    assert len(calls) == 3
    assert [w.start_ms for w in out.words] == [5000, 1203000, 2401000]
    assert not list(tmp_path.glob("*.ogg"))


def _aged(path: Path, days: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x")
    old = time.time() - days * 86400
    os.utime(path, (old, old))
    return path


def test_old_render_folders_are_removed_and_new_ones_kept():
    work = settings().data_dir / "work"
    old = _aged(work / "exp_old" / "f.txt", 5).parent
    os.utime(old, (time.time() - 5 * 86400, time.time() - 5 * 86400))
    fresh = _aged(work / "exp_new" / "f.txt", 0).parent
    storage.sweep_local()
    assert not old.exists()
    assert fresh.exists()


def test_local_media_is_only_evicted_when_the_bucket_has_it(monkeypatch):
    item = _aged(settings().media_root / "mezzanine" / "a.mp4", 5)
    storage.sweep_local()
    assert item.exists()
    monkeypatch.setattr(settings(), "storage_backend", "s3")
    storage.sweep_local()
    assert not item.exists()


def test_recent_media_stays_cached(monkeypatch):
    item = _aged(settings().media_root / "mezzanine" / "b.mp4", 0.5)
    monkeypatch.setattr(settings(), "storage_backend", "s3")
    storage.sweep_local()
    assert item.exists()


def _job(params=None):
    from app.db import session
    from app.ids import new_id
    from app.models import Job

    with session() as s:
        # Oldest in the queue, so advance_one picks this job and not one an
        # earlier test left behind (tests run without the background workers).
        row = Job(id=new_id("job"), asset_id="ast_x", params=params or {}, status="processing",
                  stage="finding", created_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
        s.add(row)
        s.commit()
        return row.id


def _read(job_id):
    from app.db import session
    from app.models import Job

    with session() as s:
        row = s.get(Job, job_id)
        return row.status, row.error, dict(row.params or {})


def test_a_temporary_failure_is_retried_then_gives_up(monkeypatch, api):
    monkeypatch.setattr(job_pipeline.time, "sleep", lambda _: None)
    monkeypatch.setattr(job_pipeline, "_step", lambda *_: (_ for _ in ()).throw(RuntimeError("network blip")))
    job_id = _job()
    job_pipeline.advance_one()
    assert _read(job_id)[0] == "processing"
    job_pipeline.advance_one()
    job_pipeline.advance_one()
    status, error, _ = _read(job_id)
    assert status == "failed"
    assert "network blip" in error


def test_a_job_that_cannot_work_fails_at_once(monkeypatch, api):
    monkeypatch.setattr(job_pipeline, "_step", lambda *_: (_ for _ in ()).throw(job_pipeline.JobFailed("No usable moments")))
    job_id = _job()
    job_pipeline.advance_one()
    assert _read(job_id)[0] == "failed"


SENTENCES = [{"start_ms": i * 8000, "end_ms": (i + 1) * 8000, "text": f"This is sentence number {i} about something."} for i in range(40)]


def test_falling_back_from_the_ai_is_reported(monkeypatch):
    monkeypatch.setattr(finder.time, "sleep", lambda _: None)
    monkeypatch.setattr(finder, "ai_find", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("provider down")))
    monkeypatch.setattr(settings(), "finder_provider", "ai")
    monkeypatch.setattr(type(settings()), "resolve_finder", lambda self: "ai")
    report: dict = {}
    assert finder.find(SENTENCES, count=2, target_ms=30000, report=report)
    assert report["note"] == finder.AI_FALLBACK_NOTE


def test_a_working_ai_reports_nothing(monkeypatch):
    moments = [finder.Moment(start_ms=0, end_ms=32000, title="a", score=90)]
    monkeypatch.setattr(finder, "ai_find", lambda *a, **k: moments)
    monkeypatch.setattr(type(settings()), "resolve_finder", lambda self: "ai")
    report: dict = {}
    finder.find(SENTENCES, count=1, target_ms=30000, report=report)
    assert "note" not in report
