"""Several workers at once: nothing is ever worked on twice."""
from __future__ import annotations

import threading
import time
from collections import Counter

import pytest

from app import idle, storage, worker
from app.config import settings
from app.db import session
from app.ids import new_id
from app.models import Asset, Export, ImportTask, Job
from app.pipeline import exports as export_pipeline
from app.pipeline import imports as import_pipeline
from app.pipeline import jobs as job_pipeline

WORKERS = 6


class Tracker:
    """Records every item a worker starts, and any item started while already running."""

    def __init__(self):
        self.lock = threading.Lock()
        self.running: set[str] = set()
        self.started: Counter[str] = Counter()
        self.overlaps: list[str] = []

    def enter(self, key: str) -> None:
        with self.lock:
            if key in self.running:
                self.overlaps.append(key)
            self.running.add(key)
            self.started[key] += 1

    def leave(self, key: str) -> None:
        with self.lock:
            self.running.discard(key)


def _race(step, until, seconds: float = 20) -> None:
    """Run `step` from many threads at once until `until()` holds."""
    deadline = time.monotonic() + seconds
    errors: list[BaseException] = []

    def loop():
        try:
            while time.monotonic() < deadline and not until():
                if not step():
                    time.sleep(0.005)
        except BaseException as e:  # surfaced below
            errors.append(e)

    threads = [threading.Thread(target=loop) for _ in range(WORKERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors, errors
    assert until(), "workers did not finish in time"


def _statuses(model, ids):
    with session() as s:
        return {i: s.get(model, i).status for i in ids}


def test_each_export_is_rendered_exactly_once(api, monkeypatch):
    tracker = Tracker()

    def fake_render(s, row):
        tracker.enter(row.id)
        time.sleep(0.02)
        tracker.leave(row.id)
        asset = Asset(id=new_id("ast"), name="Clip", type="video", category="export", status="ready")
        s.add(asset)
        s.commit()
        return asset

    monkeypatch.setattr(export_pipeline, "_render", fake_render)
    with session() as s:
        ids = []
        for _ in range(12):
            row = Export(id=new_id("exp"), project_id="prj_x", status="queued")
            s.add(row)
            ids.append(row.id)
        s.commit()

    _race(export_pipeline.advance_one,
          lambda: all(v == "completed" for v in _statuses(Export, ids).values()))
    assert not tracker.overlaps
    assert all(tracker.started[i] == 1 for i in ids), tracker.started


def test_a_job_stage_never_runs_on_two_workers_at_once(api, monkeypatch):
    tracker = Tracker()
    stages = ["transcribing", "finding", "cutting", "framing", "finalizing"]

    def fake_step(s, job):
        key = f"{job.id}:{job.status}:{job.stage}"
        tracker.enter(job.id)
        tracker.started[key] += 1
        time.sleep(0.01)
        if job.status == "queued":
            job.status, job.stage = "processing", stages[0]
        elif job.stage == stages[-1]:
            job.status = "completed"
        else:
            job.stage = stages[stages.index(job.stage) + 1]
        s.add(job)
        s.commit()
        tracker.leave(job.id)

    monkeypatch.setattr(job_pipeline, "_step", fake_step)
    with session() as s:
        ids = []
        for _ in range(8):
            row = Job(id=new_id("job"), asset_id="ast_x", status="queued")
            s.add(row)
            ids.append(row.id)
        s.commit()

    _race(job_pipeline.advance_one,
          lambda: all(v == "completed" for v in _statuses(Job, ids).values()))
    assert not tracker.overlaps
    # Every stage of every job ran exactly once: none skipped, none repeated.
    for job_id in ids:
        assert tracker.started[job_id] == 6
        assert tracker.started[f"{job_id}:queued:"] == 1
        for stage in stages:
            assert tracker.started[f"{job_id}:processing:{stage}"] == 1
    assert not job_pipeline._claimed


def test_each_import_is_downloaded_exactly_once(api, monkeypatch):
    from app.pipeline import ingest

    tracker = Tracker()

    def fake_import(s, asset, url, **_):
        tracker.enter(asset.id)
        time.sleep(0.02)
        tracker.leave(asset.id)
        asset.status = "ready"
        s.add(asset)
        s.commit()

    monkeypatch.setattr(ingest, "import_url", fake_import)
    with session() as s:
        ids = []
        for _ in range(10):
            asset = Asset(id=new_id("ast"), name="Link", type="video", status="importing",
                          source_url="https://example.com/v")
            s.add(asset)
            s.add(ImportTask(asset_id=asset.id))
            ids.append(asset.id)
        s.commit()

    _race(import_pipeline.advance_one,
          lambda: all(v == "completed" for v in _statuses(ImportTask, ids).values()))
    assert not tracker.overlaps
    assert all(tracker.started[i] == 1 for i in ids), tracker.started


def test_two_jobs_on_one_source_transcribe_it_once(api, monkeypatch):
    """The second job waits for the first and reuses its transcript."""
    from app.models import Transcript

    calls = []

    def fake_transcribe(audio, *a, **k):
        calls.append(audio)
        time.sleep(0.05)

        class Result:
            language, model = "en", "fake"

            def as_dicts(self):
                return [{"text": "hi", "start_ms": 0, "end_ms": 500}], []

        return Result()

    monkeypatch.setattr(job_pipeline, "transcribe", fake_transcribe)
    monkeypatch.setattr(job_pipeline.media, "extract_audio", lambda src, dest, **k: dest.write_bytes(b""))
    monkeypatch.setattr(job_pipeline.storage, "local_path", lambda key: settings().media_root / "src.mp4")
    asset_id = new_id("ast")
    with session() as s:
        s.add(Asset(id=asset_id, name="Talk", type="video", status="ready", length_s=10,
                    storage_key="mezzanine/src.mp4"))
        s.commit()

    def run():
        with session() as s:
            job_pipeline._ensure_transcript(s, s.get(Asset, asset_id), {})

    threads = [threading.Thread(target=run) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1
    with session() as s:
        from sqlmodel import select

        rows = s.exec(select(Transcript).where(Transcript.asset_id == asset_id)).all()
    assert [r.status for r in rows] == ["ready"]


def test_the_database_runs_in_wal_mode(api):
    from app.db import engine

    with engine().connect() as c:
        assert c.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert c.exec_driver_sql("PRAGMA busy_timeout").scalar() == 30000


def test_the_sweep_waits_for_running_steps(monkeypatch):
    swept = []
    monkeypatch.setattr(storage, "sweep_if_due", lambda: swept.append(1))
    inside = threading.Event()
    release = threading.Event()

    def slow_step():
        inside.set()
        release.wait(5)
        return True

    t = threading.Thread(target=worker._run, args=(slow_step,))
    t.start()
    inside.wait(5)
    assert worker.busy()
    worker._sweep()
    assert swept == []          # never under a running step
    release.set()
    t.join()
    worker._sweep()
    assert swept == [1]


def test_start_runs_a_pool_per_queue_and_stop_drains_them(monkeypatch):
    calls = Counter()
    lock = threading.Lock()

    def counting(kind):
        def step():
            with lock:
                calls[kind] += 1
            return False
        return step

    monkeypatch.setattr(settings(), "worker_enabled", True)
    monkeypatch.setattr(worker, "_steps_by_kind",
                        lambda: {k: counting(k) for k in ("import", "job", "export")})
    monkeypatch.setattr(idle, "sleep_if_idle", lambda: False)
    worker.start(interval=0.01)
    try:
        names = sorted(t.name for t in worker._threads)
        sizes = worker.pool_sizes()
        assert names.count("engine-housekeeping") == 1
        for kind, size in sizes.items():
            assert sum(n.startswith(f"engine-{kind}-") for n in names) == size
        time.sleep(0.1)
        assert set(calls) == {"import", "job", "export"}
    finally:
        worker.stop(timeout=5)
    assert not any(t.is_alive() for t in worker._threads)


def test_default_pools_suit_two_cpus():
    sizes = worker.pool_sizes()
    assert sizes["job"] >= 2 and sizes["import"] >= 2
    # More parallel renders than cores only thrashes.
    assert 1 <= sizes["export"] <= 2
