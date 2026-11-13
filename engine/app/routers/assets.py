"""Uploads, imports and the asset list."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlmodel import select

from .. import storage
from ..config import settings
from ..db import session
from ..errors import EngineError
from ..responses import ok
from ..ids import new_id
from ..models import Asset, ImportTask, Upload, utcnow
from ..pipeline import analyze as url_analyze
from ..pipeline import ingest

router = APIRouter()


class UploadStart(BaseModel):
    filename: str
    content_type: str
    size_bytes: int


@router.post("/v1/uploads")
def start_upload(body: UploadStart, request: Request) -> dict:
    kind = ingest.kind_for(body.content_type)
    limit = ingest.limit_for(kind)
    if body.size_bytes > limit:
        raise EngineError("FILE_TOO_LARGE", f"{kind.title()} files are limited to {limit // 1024**2} MB.")
    upload = Upload(id=new_id("upl"), filename=body.filename, content_type=body.content_type,
                    size_bytes=body.size_bytes, storage_key=f"incoming/{new_id('raw')}")
    with session() as s:
        s.add(upload)
        s.commit()
    # Behind Fly's proxy the request looks like plain http; the real address is configured.
    configured = settings().public_base_url
    base = (configured if "localhost" not in configured else str(request.base_url)).rstrip("/")
    return ok(
        id=upload.id,
        url=f"{base}/v1/uploads/{upload.id}/bytes",
        method="PUT",
        headers={"content-type": body.content_type},
        expires_at=utcnow().isoformat(),
    )


@router.put("/v1/uploads/{upload_id}/bytes")
async def put_bytes(upload_id: str, request: Request) -> dict:
    with session() as s:
        upload = s.get(Upload, upload_id)
        if not upload:
            raise EngineError("NOT_FOUND", "That upload does not exist.")
        if upload.status != "pending":
            raise EngineError("VALIDATION_ERROR", "That upload has already been finished.")
        dest = storage.open_write(upload.storage_key)
        written = 0
        limit = ingest.limit_for(ingest.kind_for(upload.content_type))
        with dest.open("wb") as f:
            async for chunk in request.stream():
                written += len(chunk)
                if written > limit:
                    f.close()
                    dest.unlink(missing_ok=True)
                    raise EngineError("FILE_TOO_LARGE", "That file is over the limit for its type.")
                f.write(chunk)
        upload.size_bytes = written
        s.add(upload)
        s.commit()
    return ok(bytes=written)


@router.post("/v1/uploads/{upload_id}/complete")
def complete_upload(upload_id: str) -> dict:
    with session() as s:
        upload = s.get(Upload, upload_id)
        if not upload:
            raise EngineError("NOT_FOUND", "That upload does not exist.")
        # Preparing a long video can outlive the caller, who may ask again.
        earlier = _asset_for(s, upload)
        if earlier:
            return ok(ingest.asset_payload(earlier))
        path = storage.open_write(upload.storage_key)
        if not path.exists() or path.stat().st_size == 0:
            raise EngineError("VALIDATION_ERROR", "No bytes were received for that upload.")
        kind = ingest.kind_for(upload.content_type)
        asset = Asset(id=new_id("ast"), name=upload.filename, type=kind,
                      storage_key=upload.storage_key, size_bytes=path.stat().st_size)
        s.add(asset)
        s.commit()
        if kind == "video":
            try:
                ingest.ingest_video(s, asset, path)
            except Exception as e:
                ingest.mark_failed(s, asset, e)
                raise
        else:
            storage.put_file(path, upload.storage_key, upload.content_type)
            asset.status = "ready"
            s.add(asset)
            s.commit()
        upload.status = "completed"
        s.add(upload)
        s.commit()
        s.refresh(asset)
        return ok(ingest.asset_payload(asset))


def _asset_for(s, upload: Upload) -> Asset | None:
    return s.exec(select(Asset).where(Asset.storage_key == upload.storage_key)).first()


@router.get("/v1/uploads/{upload_id}")
def get_upload(upload_id: str) -> dict:
    """Which asset an upload became, for a caller who stopped waiting on /complete."""
    with session() as s:
        upload = s.get(Upload, upload_id)
        if not upload:
            raise EngineError("NOT_FOUND", "That upload does not exist.")
        asset = _asset_for(s, upload)
        return ok(status=upload.status, asset=ingest.asset_payload(asset) if asset else None)


class AnalyzeBody(BaseModel):
    url: str
    #: Also return the video's own captions as a transcript.
    transcript: bool = False


@router.post("/v1/analyze")
def analyze_url(body: AnalyzeBody) -> dict:
    """Read a link's details so the creator can choose before anything downloads."""
    return ok(url_analyze.analyze(body.url, transcript=body.transcript).payload())


class ImportBody(BaseModel):
    url: str
    name: str = ""
    rights_confirmed: bool = False


@router.post("/v1/assets")
def import_asset(body: ImportBody) -> dict:
    if ingest.needs_rights(body.url) and not body.rights_confirmed:
        raise EngineError("RIGHTS_REQUIRED", "Confirm you own this footage or have the rights to clip it.")
    with session() as s:
        # The whole video only: a lean run's HD sections carry the same link,
        # and reusing the newest one handed a new clip job 82 s of a 58-minute video.
        existing = s.exec(select(Asset).where(Asset.source_url == body.url,
                          Asset.deleted_at == None, Asset.status.in_(["importing", "ready"]),  # noqa: E711
                          Asset.category != "section")
                          .order_by(Asset.created_at.desc())).first()
        if existing:
            return ok(ingest.asset_payload(existing))
        asset = Asset(id=new_id("ast"), name=body.name or body.url.rsplit("/", 1)[-1][:120],
                      type="video", status="importing", rights_confirmed=body.rights_confirmed,
                      source_url=body.url)
        s.add(asset)
        s.add(ImportTask(asset_id=asset.id))
        s.commit()
        s.refresh(asset)
        # Downloading a long video takes minutes; a browser request dies long
        # before that. Hand it to the worker and answer now. The caller polls
        # GET /v1/assets/{id}, or waits for the asset.imported webhook.
        return ok(ingest.asset_payload(asset))


@router.get("/v1/assets")
def list_assets(type: str | None = None, category: str | None = None, page: int = 1) -> dict:
    with session() as s:
        q = select(Asset).where(Asset.deleted_at == None)  # noqa: E711
        if type:
            q = q.where(Asset.type == type)
        if category:
            q = q.where(Asset.category == category)
        rows = s.exec(q.order_by(Asset.created_at.desc()).offset((page - 1) * 25).limit(25)).all()  # type: ignore[attr-defined]
        return ok(assets=[ingest.asset_payload(a) for a in rows])


@router.get("/v1/assets/{asset_id}")
def get_asset(asset_id: str) -> dict:
    with session() as s:
        asset = s.get(Asset, asset_id)
        if not asset or asset.deleted_at:
            raise EngineError("NOT_FOUND", "No asset with that id.")
        return ok(ingest.asset_payload(asset))


@router.delete("/v1/assets/{asset_id}")
def delete_asset(asset_id: str) -> dict:
    with session() as s:
        asset = s.get(Asset, asset_id)
        if not asset:
            raise EngineError("NOT_FOUND", "No asset with that id.")
        for key in filter(None, [asset.storage_key, asset.mezzanine_key, asset.thumb_key]):
            storage.delete(key)
        asset.deleted_at = utcnow()
        s.add(asset)
        s.commit()
    return ok()
