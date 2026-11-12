"""Durable imports, claimed atomically so several import workers can run.

The mounted SQLite file outlives the process. Boot recovery is safe only with
one Engine process per volume, just like jobs and exports.
"""
import logging
import time

from sqlalchemy import update
from sqlmodel import select

from ..db import session
from ..models import Asset, ImportTask
from . import ingest

log = logging.getLogger("engine.imports")

MAX_ATTEMPTS = 3
#: Seconds to wait before a passing failure is tried again, times the attempt number.
RETRY_WAIT_S = 20


def recover() -> int:
    count = 0
    with session() as s:
        # Include pre-queue imports interrupted by an older deployment.
        for asset in s.exec(select(Asset).where(Asset.status == "importing", Asset.deleted_at == None)).all():
            if not s.get(ImportTask, asset.id) and asset.source_url:
                s.add(ImportTask(asset_id=asset.id))
                count += 1
        for task in s.exec(select(ImportTask).where(ImportTask.status == "processing")).all():
            task.status = "queued"
            s.add(task)
            count += 1
        s.commit()
    return count


def advance_one() -> bool:
    with session() as s:
        task = None
        ids = s.exec(select(ImportTask.asset_id).where(ImportTask.status == "queued")
                     .order_by(ImportTask.created_at)).all()
        for asset_id in ids:
            # One conditional UPDATE: of two racing workers exactly one wins,
            # and the other tries the next task.
            claimed = s.exec(update(ImportTask).where(ImportTask.asset_id == asset_id,
                             ImportTask.status == "queued").values(status="processing", attempts=ImportTask.attempts + 1))
            s.commit()
            if claimed.rowcount == 1:
                task = s.get(ImportTask, asset_id)
                break
        if not task:
            return False
        asset = s.get(Asset, task.asset_id)
        if not asset or asset.deleted_at or asset.status == "ready":
            task.status = "completed"
        elif task.attempts > MAX_ATTEMPTS:
            ingest.mark_failed(s, asset, RuntimeError("Import interrupted three times; start a fresh import."))
            task.status = "failed"
        else:
            try:
                ingest.import_url(s, asset, asset.source_url, can_retry=task.attempts < MAX_ATTEMPTS)
                task.status = "completed"
            except Exception as e:
                if getattr(e, "transient", False) and task.attempts < MAX_ATTEMPTS:
                    # A passing failure: back in the queue after a short wait.
                    log.warning("import of %s hit a passing error, retrying (%s): %s", asset.id, task.attempts, e)
                    time.sleep(RETRY_WAIT_S * task.attempts)
                    task.status = "queued"
                else:
                    # import_url persists the actual failure and emits its event.
                    task.status = "failed"
        s.add(task)
        s.commit()
        return True