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
        status="ok", version="0.2.0",
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
        engine="crayzmundo", version="0.2.0", mock=cfg.engine_mock,
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


@router.get("/v1/proxy/health")
def proxy_health_summary(days: int = 7) -> dict:
    """The last week of YouTube downloads through the proxy: refusals, speed, long links.

    Read-only, behind the API key like every route but /v1/health. BookedSecure
    only asks while the Engine is already awake, so this never wakes it.
    """
    from ..pipeline import proxy_health

    return ok(**proxy_health.summary(days=max(1, min(days, 30))))


@router.get("/v1/subtitle-styles")
def subtitle_styles() -> dict:
    return ok(styles=caption_catalog())


#: Every choice the Engine offers, in one place, with words a creator reads.
#: The app's Studio and the assistants' tools are built from this, so a new
#: layout here is a new button there without either side being told twice.
LAYOUT_CATALOG = [
    {"id": "auto", "name": "Let the Engine choose", "hint": "Each clip gets the look that suits what it shows (split screen for two people talking, screen + speaker for slides, the whole picture for wide scenes), then shot by shot", "needs": None},
    {"id": "full-video", "name": "Follow the speaker", "hint": "One crop that holds on whoever is talking, re-aimed on every cut", "needs": None},
    {"id": "split", "name": "Split screen", "hint": "Two people who share the shot, one cell each", "needs": "two people in the same shot"},
    {"id": "grid", "name": "Group grid", "hint": "Three or four people, each framed in their own cell", "needs": "three or four people in the same shot"},
    {"id": "screen", "name": "Screen + speaker", "hint": "The picture on top, the person below: slides, screen shares, gameplay", "needs": "a face"},
    {"id": "pip", "name": "Picture-in-picture", "hint": "The main shot with the other person's face in a small inset", "needs": "two people, or a small face over a wide picture"},
    {"id": "streamer", "name": "Blurred background", "hint": "The whole picture over a blurred copy of itself", "needs": None},
    {"id": "black-box", "name": "Black bars", "hint": "The whole picture with black above and below", "needs": None},
    {"id": "title-subtitles", "name": "Headline + captions", "hint": "The picture in the middle, the headline above and the words below", "needs": None},
]
ZOOM_CATALOG = [
    {"id": "off", "name": "No zoom", "hint": "The crop is as wide as the output allows"},
    {"id": "auto", "name": "Push in on wide shots", "hint": "Tighter when the person is small in the frame, with room above the head"},
    {"id": "moments", "name": "Punch in on lines", "hint": "Pushes in further on every other sentence, for energy"},
]
POSITION_CATALOG = [
    {"id": "top", "name": "Top"}, {"id": "middle", "name": "Middle"}, {"id": "lower", "name": "Lower"},
]
TITLE_STYLE_CATALOG = [
    {"id": "bold_band", "name": "Bold band", "hint": "Capitals on a dark band"},
    {"id": "boxed", "name": "Boxed", "hint": "As written, on a softer box"},
    {"id": "headline", "name": "Headline", "hint": "Capitals with an outline, no box"},
    {"id": "clean", "name": "Clean", "hint": "As written, with a soft shadow"},
]
FOCUS_CATALOG = [
    {"id": "auto", "name": "Let the finder decide"},
    {"id": "speaker", "name": "Whoever is talking"},
    {"id": "reaction", "name": "The other person's reaction"},
    {"id": "everyone", "name": "Everyone in the shot"},
]


@router.get("/v1/catalog")
def catalog() -> dict:
    from ..pipeline.compose import ASPECTS
    from ..pipeline.find import GENRES

    return ok(
        version="0.2.0",
        layouts=LAYOUT_CATALOG, zoom=ZOOM_CATALOG, caption_positions=POSITION_CATALOG,
        caption_size={"min": 0.6, "max": 1.6, "default": 1.0},
        caption_styles=caption_catalog(), title_styles=TITLE_STYLE_CATALOG, focus=FOCUS_CATALOG,
        aspects=[{"id": k, "w": w, "h": h} for k, (w, h) in ASPECTS.items()],
        resolutions=["1080p", "2160p"], genres=GENRES,
        modes=["auto", "speech", "energy", "visual"],
        clip_length={"min_s": 5, "max_s": 180, "default": "auto"},
    )


@router.post("/v1/webhooks/test")
def webhook_test() -> dict:
    event_id = webhooks.emit("test.ping", {})
    return ok(event_id=event_id)
