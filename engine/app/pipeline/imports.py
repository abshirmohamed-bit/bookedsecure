"""Durable imports, claimed atomically by the single container's worker.

The mounted SQLite file outlives the process. Boot recovery is safe only with
one Engine process per volume, just like the existing job/export worker.
"""
from sqlalchemy import update
from sqlmodel import select

from ..db import session
from ..models import Asset, ImportTask
from . import ingest

MAX_ATTEMPTS = 3


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
        task = s.exec(select(ImportTask).where(ImportTask.status == "queued")
                      .order_by(ImportTask.created_at).limit(1)).first()
        if not task:
            return False
        claimed = s.exec(update(ImportTask).where(ImportTask.asset_id == task.asset_id,
                         ImportTask.status == "queued").values(status="processing", attempts=ImportTask.attempts + 1))
        s.commit()
        if claimed.rowcount != 1:
            return False
        s.refresh(task)
        asset = s.get(Asset, task.asset_id)
        if not asset or asset.deleted_at or asset.status == "ready":
            task.status = "completed"
        elif task.attempts > MAX_ATTEMPTS:
            ingest.mark_failed(s, asset, RuntimeError("Import interrupted three times; start a fresh import."))
            task.status = "failed"
        else:
            try:
                ingest.import_url(s, asset, asset.source_url)
                task.status = "completed"
            except Exception:
                # import_url persists the actual failure and emits its event.
                task.status = "failed"
        s.add(task)
        s.commit()
        return True