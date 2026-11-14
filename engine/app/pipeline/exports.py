"""Rendering an approved clip to a finished file."""
from __future__ import annotations

import logging
import shutil
import time
from pathlib import Path

from sqlalchemy import update
from sqlmodel import Session, select

from .. import media, storage, webhooks
from ..config import settings
from ..db import session as db_session
from ..ids import new_id
from ..models import Asset, Export, Project
from . import render_gate
from .compose import Render, run as run_render

log = logging.getLogger("engine.exports")

#: Exports render as many at once as the machine has memory for (render_gate):
#: one on the 4 GB machine, more on a bigger one.
#: Exports retried after running out of memory, by id (this process only).
_MEMORY_RETRIES: dict[str, int] = {}
MEMORY_RETRIES = 2
MEMORY_RETRY_WAIT_S = 15


def _out_of_memory(e: Exception) -> bool:
    text = str(e).lower()
    return isinstance(e, MemoryError) or "cannot allocate memory" in text or "out of memory" in text


def create(session: Session, project: Project, resolution: str = "1080p") -> Export:
    row = Export(id=new_id("exp"), project_id=project.id, resolution=resolution, status="queued")
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def advance_one() -> bool:
    with db_session() as s:
        row = _claim(s)
        if not row:
            return False
        try:
            w = render_gate.weight(row.resolution)
            render_gate.GATE.acquire(w)
            try:
                asset = _render(s, row)
            finally:
                render_gate.GATE.release(w)
            row.status = "completed"
            row.progress = 100
            row.asset_id = asset.id
            s.add(row)
            s.commit()
            from .ingest import asset_payload

            webhooks.emit("export.completed", {
                "export_id": row.id, "project_id": row.project_id, "asset": asset_payload(asset)})
        except Exception as e:
            tries = _MEMORY_RETRIES.get(row.id, 0)
            if _out_of_memory(e) and tries < MEMORY_RETRIES:
                # Passing: memory frees up as other work finishes. Back in the queue.
                _MEMORY_RETRIES[row.id] = tries + 1
                log.warning("export %s ran out of memory, retrying (%d)", row.id, tries + 1)
                time.sleep(MEMORY_RETRY_WAIT_S)
                row.status = "queued"
                row.progress = 0
                s.add(row)
                s.commit()
                return True
            # Logged in full: the stored error is cut to 500 characters.
            log.exception("export %s of project %s failed", row.id, row.project_id)
            row.status = "failed"
            row.error = str(e)[:500]
            s.add(row)
            s.commit()
            webhooks.emit("export.failed",
                          {"export_id": row.id, "project_id": row.project_id, "error": row.error})
        return True


def _claim(s: Session) -> Export | None:
    """Take the oldest queued export so no other worker can.

    The status flip is one conditional UPDATE: of two workers racing for the
    same row exactly one changes it, and the loser moves on to the next.
    """
    ids = s.exec(select(Export.id).where(Export.status == "queued").order_by(Export.created_at)).all()
    for export_id in ids:
        claimed = s.exec(update(Export).where(Export.id == export_id, Export.status == "queued")
                         .values(status="processing", progress=10))
        s.commit()
        if claimed.rowcount == 1:
            return s.get(Export, export_id)
    return None


def render_for(project: Project, source: Path, out: Path, *, resolution: str = "1080p",
               preview: bool = False, overrides: dict | None = None) -> Render:
    """The render a project describes, with the editor's unsaved tweaks laid over it.

    Every path to a picture of a clip — export, preview, the editor's framing
    call — comes through here, so a setting cannot be honoured by one and
    ignored by another.
    """
    o = overrides or {}
    options = {**(project.caption_options or {}), **(o.get("caption_options") or {})}
    framing = {**(project.framing or {}), **(o.get("framing") or {})}
    title = {**(project.title or {}), **(o.get("title") or {})} if (project.title or o.get("title")) else None
    size = options.get("size", 1.0)
    try:
        size = float(size)
    except (TypeError, ValueError):
        size = 1.0
    return Render(
        source=source, out=out, in_ms=int(o.get("in_ms", project.in_ms)), out_ms=int(o.get("out_ms", project.out_ms)),
        aspect=o.get("aspect") or project.aspect, layout=o.get("layout") or project.layout,
        framing_mode=framing.get("mode", "auto"), focus=framing.get("focus", "auto"),
        zoom=framing.get("zoom", "auto"),
        words=list(o.get("captions") if o.get("captions") is not None else (project.captions or [])),
        caption_style_id=o.get("caption_style_id") or project.caption_style_id,
        captions_enabled=options.get("enabled", True),
        caption_position=options.get("position"), caption_size=size, caption_y=options.get("y"),
        caption_max_words=options.get("max_words"),
        censored=options.get("censored_words") or [],
        emphasis=[str(x) for x in (options.get("emphasis") or [])][:3] if isinstance(options.get("emphasis"), list) else None,
        title=title, watermark=project.watermark or None,
        resolution=resolution, preview=preview, loudnorm=not preview,
        finish_ass=(options.get("finish_ass") or {}).get("preview" if preview else resolution),
    )


def _render(s: Session, row: Export) -> Asset:
    project = s.get(Project, row.project_id)
    if not project:
        raise RuntimeError("that clip no longer exists")
    source_asset = s.get(Asset, project.asset_id)
    if not source_asset:
        raise RuntimeError("the source for that clip no longer exists")

    source = storage.local_path(source_asset.mezzanine_key or source_asset.storage_key)
    key = f"exports/{row.id}.mp4"
    out = storage.open_write(key)
    render = render_for(project, source, out, resolution=row.resolution)
    workdir = settings().data_dir / "work" / row.id
    try:
        run_render(render, workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    storage.put_file(out, key, "video/mp4")
    info = media.probe(out)

    thumb_key = f"thumbs/{row.id}.jpg"
    media.thumbnail(out, storage.open_write(thumb_key), 1.0, width=540)
    storage.put_file(storage.open_write(thumb_key), thumb_key, "image/jpeg")

    asset = Asset(
        id=new_id("ast"), name=(project.title or {}).get("text") or "Clip", type="video",
        category="export", status="ready", storage_key=key, mezzanine_key=key, thumb_key=thumb_key,
        length_s=round(info.duration_s, 3), width=info.width, height=info.height,
        fps=round(info.fps, 3), size_bytes=info.size_bytes,
    )
    s.add(asset)
    s.commit()
    return asset


def preview(s: Session, project: Project, overrides: dict | None = None) -> str:
    """A small, fast render so the app can show the clip before it is exported.

    With `overrides` (settings the editor is trying but has not saved) the
    result is a one-off under its own key and is not remembered as the
    project's preview.
    """
    source_asset = s.get(Asset, project.asset_id)
    if not source_asset:
        raise RuntimeError("the source for that clip no longer exists")
    tag = f"_{new_id('try')[-10:]}" if overrides else ""
    key = f"previews/{project.id}{tag}.mp4"
    out = storage.open_write(key)
    render = render_for(project, storage.local_path(source_asset.mezzanine_key or source_asset.storage_key),
                        out, preview=True, overrides=overrides)
    workdir = settings().data_dir / "work" / f"prev_{project.id}{tag}"
    try:
        run_render(render, workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    storage.put_file(out, key, "video/mp4")
    if not overrides:
        project.preview_key = key
        s.add(project)
        s.commit()
    return storage.public_url(key)
