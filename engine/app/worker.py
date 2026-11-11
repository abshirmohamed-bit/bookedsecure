"""Background workers that advance queued work.

Deliberately not Redis/RQ: one process, one SQLite file and a few threads keep
the whole Engine to a single container on a small host. Imports, clip jobs and
exports each get their own small pool, so one long video never holds up every
other business. Swap in a real queue only when more than one worker machine
is needed.
"""
from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from typing import Callable

log = logging.getLogger("engine.worker")

_stop = threading.Event()
_threads: list[threading.Thread] = []

# Every step claims its own row (imports and exports flip queued -> processing
# in one conditional UPDATE, jobs take an in-process claim), so any number of
# workers can run side by side without one item being worked on twice.
#
# What still needs everyone out of the way is the local sweep: it deletes old
# cached media, and must never do it under a running render. Steps count
# themselves in and out; the sweep runs only at zero and holds the lock while
# it does, so no step starts underneath it.
_steps = threading.Condition()
_running = 0


@contextmanager
def _counted():
    global _running
    with _steps:
        _running += 1
    try:
        yield
    finally:
        with _steps:
            _running -= 1


def busy() -> bool:
    """True while any worker is in the middle of a step."""
    with _steps:
        return _running > 0


def _steps_by_kind() -> dict[str, Callable[[], bool]]:
    from .pipeline import exports as export_pipeline
    from .pipeline import imports as import_pipeline
    from .pipeline import jobs as job_pipeline

    return {"import": import_pipeline.advance_one, "job": job_pipeline.advance_one,
            "export": export_pipeline.advance_one}


def _run(step: Callable[[], bool]) -> bool:
    with _counted():
        try:
            return bool(step())
        except Exception:
            log.exception("worker step failed")
            return False


def _sweep() -> None:
    from . import storage

    with _steps:
        if _running:
            return
        try:
            storage.sweep_if_due()
        except Exception:
            log.exception("local sweep failed")


def _deliver() -> None:
    from . import webhooks

    try:
        webhooks.deliver_due()
    except Exception:
        log.exception("webhook delivery failed")


def tick() -> int:
    """One synchronous pass over every queue. Returns items advanced. Used by tests."""
    done = sum(1 for step in _steps_by_kind().values() if _run(step))
    _sweep()
    _deliver()
    return done


def _work_loop(step: Callable[[], bool], interval: float) -> None:
    while not _stop.is_set():
        _stop.wait(0 if _run(step) else interval)


def _housekeeping_loop(interval: float) -> None:
    from . import idle

    while not _stop.wait(interval):
        _sweep()
        _deliver()
        # Never stop the machine with a step under way; the queues being empty
        # in the database is checked by sleep_if_idle itself.
        if busy():
            continue
        try:
            idle.sleep_if_idle()
        except Exception:
            log.exception("idle check failed")


def pool_sizes() -> dict[str, int]:
    from .config import settings

    cfg = settings()
    return {"import": max(1, cfg.import_workers), "job": max(1, cfg.job_workers),
            "export": max(1, cfg.concurrent_renders)}


def start(interval: float = 1.0) -> None:
    from .config import settings

    if not settings().worker_enabled or any(t.is_alive() for t in _threads):
        return
    _stop.clear()
    _threads.clear()
    steps = _steps_by_kind()
    for kind, size in pool_sizes().items():
        for i in range(size):
            _threads.append(threading.Thread(target=_work_loop, args=(steps[kind], interval),
                                             daemon=True, name=f"engine-{kind}-{i}"))
    _threads.append(threading.Thread(target=_housekeeping_loop, args=(interval,),
                                     daemon=True, name="engine-housekeeping"))
    for t in _threads:
        t.start()
    log.info("worker started: %s", pool_sizes())


def stop(timeout: float | None = None) -> None:
    """Ask every worker to finish what it is doing, then wait for them.

    A render takes tens of seconds. Giving it five was enough to kill one
    mid-frame on every deploy and leave the export stuck in "processing".
    The grace period is shared: all workers drain at once, not one after another.
    """
    from .config import settings

    _stop.set()
    deadline = time.monotonic() + (timeout if timeout is not None else settings().shutdown_grace_s)
    for t in _threads:
        t.join(timeout=max(0.0, deadline - time.monotonic()))
    left = [t.name for t in _threads if t.is_alive()]
    if left:
        log.warning("workers did not finish in time (%s); in-flight work will be retried on boot",
                    ", ".join(left))


def recover_stuck() -> int:
    """Put work that was interrupted back in the queue.

    A machine can vanish mid-render — a deploy, a host migration, an out-of-
    memory kill. Whatever was "processing" belongs to nobody once the process
    is gone, so on boot it goes back to "queued" rather than hanging forever.
    """
    from sqlmodel import select

    from .db import session
    from .models import Asset, Export, Job

    moved = 0
    from .pipeline.imports import recover
    moved += recover()
    with session() as s:
        for model in (Job, Export):
            for row in s.exec(select(model).where(model.status == "processing")).all():
                row.status = "queued"
                row.progress = 0
                s.add(row)
                moved += 1
        for asset in s.exec(select(Asset).where(Asset.status == "downloading")).all():
            asset.status = "importing"
            s.add(asset)
            moved += 1
        if moved:
            s.commit()
    if moved:
        log.info("requeued %d item(s) interrupted by the last shutdown", moved)
    return moved


def drain(max_passes: int = 200, sleep: float = 0.01, until: Callable[[], bool] | None = None) -> int:
    """Run the loop synchronously until there is nothing left. Used by tests."""
    passes = 0
    while passes < max_passes:
        advanced = tick()
        passes += 1
        if until and until():
            break
        if not advanced:
            break
        time.sleep(sleep)
    return passes
