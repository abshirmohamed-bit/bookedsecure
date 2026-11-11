"""Health, account, catalogs and the webhook test."""
from __future__ import annotations

from fastapi import APIRouter
from sqlmodel import select

from .. import storage, webhooks
from ..config import settings
from ..db import session
from ..models import Export, Job
from ..pipeline.caption import catalog as caption_catalog
from ..responses import ok

router = APIRouter()


@router.get("/v1/health")
def health() -> dict:
    import shutil

    cfg = settings()
    return ok(
        status="ok", version="0.1.0",
        ffmpeg=bool(shutil.which("ffmpeg")), whisper_model=cfg.whisper_model,
        storage_backend=cfg.storage_backend,
        # The resolved provider, not the setting: "auto" tells nobody anything.
        transcribe_provider=cfg.resolve_transcriber(), finder=cfg.resolve_finder(),
        # Which build is actually answering. The app and the Engine deploy
        # separately, and "is the Engine running my change yet?" has had to be
        # guessed from behaviour more than once; a deploy that forgot to
        # happen looks exactly like a change that did not work. FLY_IMAGE_REF
        # is set by Fly and moves on every deploy, so it needs nobody to
        # remember anything. GIT_SHA is better when the build passes one.
        build=_build_id(),
    )


def _build_id() -> str:
    """Something that changes on every deploy, for telling builds apart."""
    import os

    sha = os.environ.get("GIT_SHA", "").strip()
    if sha:
        return sha[:12]
    ref = os.environ.get("FLY_IMAGE_REF", "").strip()
    return ref.rsplit(":", 1)[-1][:24] if ref else "unknown"


@router.get("/v1/account")
def account() -> dict:
    cfg = settings()
    with session() as s:
        pending = len(s.exec(select(Job).where(Job.status.in_(["queued", "processing"]))).all())  # type: ignore[attr-defined]
        rendering = len(s.exec(select(Export).where(Export.status.in_(["queued", "processing"]))).all())  # type: ignore[attr-defined]
    used = storage.usage_bytes()
    # a rough minute per queued job keeps the app's "estimated wait" honest
    wait_s = pending * 60 + rendering * 30
    return ok(
        engine="crayzmundo", version="0.1.0", mock=cfg.engine_mock,
        gpu=cfg.whisper_device == "cuda",
        # `used`/`limit` and `estimated_wait_minutes` are the names the app reads.
        storage={"used": used, "limit": cfg.storage_limit_bytes, "trashed": 0},
        queue={"pending": pending, "running": rendering,
               "estimated_wait_minutes": -(-wait_s // 60) if wait_s else 0,
               "estimated_wait_seconds": wait_s},
        limits={"max_upload_bytes": cfg.max_upload_bytes,
                "max_source_seconds": cfg.max_source_seconds,
                "max_clips_per_job": 60, "concurrent_jobs": cfg.concurrent_jobs},
        providers={"transcribe": cfg.transcribe_provider, "finder": cfg.resolve_finder()},
    )


@router.get("/v1/subtitle-styles")
def subtitle_styles() -> dict:
    return ok(styles=caption_catalog())


@router.post("/v1/webhooks/test")
def webhook_test() -> dict:
    event_id = webhooks.emit("test.ping", {})
    return ok(event_id=event_id)
