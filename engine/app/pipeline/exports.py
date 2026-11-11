"""Rendering an approved clip to a finished file."""
from __future__ import annotations

import shutil
from pathlib import Path

from sqlmodel import Session, select

from .. import media, storage, webhooks
from ..config import settings
from ..db import session as db_session
from ..ids import new_id
from ..models import Asset, Export, Project
from .compose import Render, run as run_render


def create(session: Session, project: Project, resolution: str = "1080p") -> Export:
    row = Export(id=new_id("exp"), project_id=project.id, resolution=resolution, status="queued")
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def advance_one() -> bool:
    with db_session() as s:
        row = s.exec(select(Export).where(Export.status == "queued").order_by(Export.created_at)).first()
        if not row:
            return False
        row.status = "processing"
        row.progress = 10
        s.add(row)
        s.commit()
        try:
            asset = _render(s, row)
            row.status = "completed"
            row.progress = 100
            row.asset_id = asset.id
            s.add(row)
            s.commit()
            from .ingest import asset_payload

            webhooks.emit("export.completed", {
                "export_id": row.id, "project_id": row.project_id, "asset": asset_payload(asset)})
        except Exception as e:
            row.status = "failed"
            row.error = str(e)[:500]
            s.add(row)
            s.commit()
            webhooks.emit("export.failed",
                          {"export_id": row.id, "project_id": row.project_id, "error": row.error})
        return True


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
    options = project.caption_options or {}
    render = Render(
        source=source, out=out, in_ms=project.in_ms, out_ms=project.out_ms,
        aspect=project.aspect, layout=project.layout,
        framing_mode=(project.framing or {}).get("mode", "auto"),
        focus=(project.framing or {}).get("focus", "auto"),
        words=list(project.captions or []),
        caption_style_id=project.caption_style_id,
        captions_enabled=options.get("enabled", True),
        censored=options.get("censored_words") or [],
        title=project.title or None,
        watermark=project.watermark or None,
        resolution=row.resolution,
        finish_ass=(options.get("finish_ass") or {}).get(row.resolution),
    )
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


def preview(s: Session, project: Project) -> str:
    """A small, fast render so the app can show the clip before it is exported."""
    source_asset = s.get(Asset, project.asset_id)
    if not source_asset:
        raise RuntimeError("the source for that clip no longer exists")
    key = f"previews/{project.id}.mp4"
    out = storage.open_write(key)
    options = project.caption_options or {}
    render = Render(
        source=storage.local_path(source_asset.mezzanine_key or source_asset.storage_key),
        out=out, in_ms=project.in_ms, out_ms=project.out_ms, aspect=project.aspect,
        layout=project.layout, framing_mode=(project.framing or {}).get("mode", "auto"),
        focus=(project.framing or {}).get("focus", "auto"),
        words=list(project.captions or []), caption_style_id=project.caption_style_id,
        captions_enabled=options.get("enabled", True), title=project.title or None,
        watermark=project.watermark or None, preview=True, loudnorm=False,
        finish_ass=(options.get("finish_ass") or {}).get("preview"),
    )
    workdir = settings().data_dir / "work" / f"prev_{project.id}"
    try:
        run_render(render, workdir)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    storage.put_file(out, key, "video/mp4")
    project.preview_key = key
    s.add(project)
    s.commit()
    return storage.public_url(key)
