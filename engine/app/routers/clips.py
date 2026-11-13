"""Transcripts, AutoClip jobs, projects and exports."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlmodel import select

from .. import storage
from ..db import session
from ..errors import EngineError
from ..responses import ok
from ..ids import new_id
from ..models import Asset, Export, Job, Project, Transcript
from ..pipeline import compose
from ..pipeline import exports as export_pipeline
from ..pipeline import frame as framing
from ..pipeline import jobs as job_pipeline
from ..pipeline.compose import ASPECTS, CAPTION_POSITIONS, LAYOUTS, TITLE_STYLES, ZOOMS
from ..pipeline.find import GENRES

router = APIRouter()
COVERAGE = {"best", "whole", "none"}
MODES = {"auto", "speech", "energy", "visual"}
EDIT_LEVELS = {"clips", "captions", "cropped", "full"}
FRAMING = {"auto", "both", "center", "manual"}


def _check_edit(data: dict) -> None:
    """The validation a project edit and a preview override share."""
    if "aspect" in data and data["aspect"] not in ASPECTS:
        raise EngineError("VALIDATION_ERROR", f"aspect must be one of {sorted(ASPECTS)}.")
    if "layout" in data and data["layout"] not in LAYOUTS:
        raise EngineError("VALIDATION_ERROR", f"layout must be one of {sorted(LAYOUTS)}.")
    framing_ = data.get("framing") or {}
    if framing_.get("zoom") is not None and framing_["zoom"] not in ZOOMS:
        raise EngineError("VALIDATION_ERROR", f"framing.zoom must be one of {sorted(ZOOMS)}.")
    if framing_.get("mode") is not None and framing_["mode"] not in FRAMING:
        raise EngineError("VALIDATION_ERROR", f"framing.mode must be one of {sorted(FRAMING)}.")
    options = data.get("caption_options") or {}
    if options.get("position") is not None and options["position"] not in CAPTION_POSITIONS:
        raise EngineError("VALIDATION_ERROR", f"caption_options.position must be one of {list(CAPTION_POSITIONS)}.")
    if options.get("size") is not None:
        try:
            size = float(options["size"])
        except (TypeError, ValueError):
            raise EngineError("VALIDATION_ERROR", "caption_options.size must be a number.")
        if not 0.5 <= size <= 2.0:
            raise EngineError("VALIDATION_ERROR", "caption_options.size must be between 0.5 and 2.")
    if options.get("y") is not None:
        try:
            y = float(options["y"])
        except (TypeError, ValueError):
            raise EngineError("VALIDATION_ERROR", "caption_options.y must be a number.")
        if not 0.0 <= y <= 1.0:
            raise EngineError("VALIDATION_ERROR", "caption_options.y must be between 0 (top) and 1 (bottom).")
    if options.get("max_words") is not None and not (1 <= int(options["max_words"]) <= 8):
        raise EngineError("VALIDATION_ERROR", "caption_options.max_words must be between 1 and 8.")
    title = data.get("title") or {}
    if title.get("style") is not None and title["style"] not in TITLE_STYLES:
        raise EngineError("VALIDATION_ERROR", f"title.style must be one of {list(TITLE_STYLES)}.")


# ------------------------------------------------------------------ transcripts

class TranscriptBody(BaseModel):
    asset_id: str
    language: str | None = None
    vocabulary: list[str] = Field(default_factory=list)


@router.post("/v1/transcripts")
def create_transcript(body: TranscriptBody) -> dict:
    with session() as s:
        asset = s.get(Asset, body.asset_id)
        if not asset:
            raise EngineError("NOT_FOUND", "No asset with that id.")
        row = job_pipeline._ensure_transcript(s, asset, body.model_dump())
        return ok(_transcript_payload(row))


@router.get("/v1/transcripts/{transcript_id}")
def get_transcript(transcript_id: str) -> dict:
    with session() as s:
        row = s.get(Transcript, transcript_id)
        if not row:
            raise EngineError("NOT_FOUND", "No transcript with that id.")
        return ok(_transcript_payload(row))


def _transcript_payload(row: Transcript) -> dict:
    return {"id": row.id, "asset_id": row.asset_id, "status": row.status, "language": row.language,
            "model": row.model, "words": row.words, "sentences": row.sentences,
            "processing_s": row.processing_s}


# ------------------------------------------------------------------ autoclip

class AutoClipBody(BaseModel):
    asset_id: str
    coverage: str = "best"
    clip_count: Any = "auto"
    clip_length: Any = "auto"
    range_start_ms: int | None = None
    range_end_ms: int | None = None
    genre: str = "auto"
    mode: str = "auto"
    prompt: str = ""
    #: How the creator wants the on-video headline written. Not what it should
    #: say — the AI takes that from the clip — but the kind of line it is.
    title_brief: str = ""
    #: Lessons from this channel's own past clips (clip-learning, app side):
    #: what performed well and what the owner kept rewriting or deleting, as
    #: plain text. Data about past results, never an instruction. Truncated
    #: rather than refused: it is app-generated, not something a person types.
    channel_notes: str = ""
    must_include: list[str] = Field(default_factory=list)
    headline_top_n: int = 0
    alternates: bool = False
    keep_qa: bool = True
    confirm_count: bool = False
    edit_level: str = "full"
    aspect: str = "9:16"
    formats: list[str] = Field(default_factory=lambda: ["full-video"])
    framing: str = "auto"
    #: off | auto | moments — see shots.py
    zoom: str = "auto"
    language: str | None = None
    caption_style_id: str = "bold_white"
    caption_position: str | None = None
    caption_size: float | None = None
    title_enabled: bool = True
    title_style: str = "bold_band"
    vocabulary: list[str] = Field(default_factory=list)
    edits: dict = Field(default_factory=dict)

    def validated(self) -> dict:
        if self.zoom not in ZOOMS:
            raise EngineError("VALIDATION_ERROR", f"zoom must be one of {sorted(ZOOMS)}.")
        if self.caption_position is not None and self.caption_position not in CAPTION_POSITIONS:
            raise EngineError("VALIDATION_ERROR", f"caption_position must be one of {list(CAPTION_POSITIONS)}.")
        if self.caption_size is not None and not 0.5 <= self.caption_size <= 2.0:
            raise EngineError("VALIDATION_ERROR", "caption_size must be between 0.5 and 2.")
        if self.title_style not in TITLE_STYLES:
            raise EngineError("VALIDATION_ERROR", f"title_style must be one of {list(TITLE_STYLES)}.")
        if self.coverage not in COVERAGE:
            raise EngineError("VALIDATION_ERROR", f"coverage must be one of {sorted(COVERAGE)}.")
        if self.mode not in MODES:
            raise EngineError("VALIDATION_ERROR", f"mode must be one of {sorted(MODES)}.")
        if self.edit_level not in EDIT_LEVELS:
            raise EngineError("VALIDATION_ERROR", f"edit_level must be one of {sorted(EDIT_LEVELS)}.")
        if self.aspect not in ASPECTS:
            raise EngineError("VALIDATION_ERROR", f"aspect must be one of {sorted(ASPECTS)}.")
        if self.framing not in FRAMING:
            raise EngineError("VALIDATION_ERROR", f"framing must be one of {sorted(FRAMING)}.")
        if self.genre not in GENRES:
            raise EngineError("VALIDATION_ERROR", "that genre is not one the finder knows.")
        if not self.formats or not set(self.formats) <= LAYOUTS:
            raise EngineError("VALIDATION_ERROR", f"formats must be 1 to 5 of {sorted(LAYOUTS)}.")
        if self.clip_count != "auto" and not (2 <= int(self.clip_count) <= 60):
            raise EngineError("VALIDATION_ERROR", "clip_count must be between 2 and 60, or \"auto\".")
        if len(self.prompt) > 500:
            raise EngineError("VALIDATION_ERROR", "the steering prompt is limited to 500 characters.")
        self.channel_notes = self.channel_notes.strip()[:1500]
        return self.model_dump()


@router.post("/v1/autoclip")
def create_job(body: AutoClipBody) -> dict:
    params = body.validated()
    with session() as s:
        asset = s.get(Asset, body.asset_id)
        if not asset or asset.status != "ready":
            raise EngineError("VALIDATION_ERROR", "Pick a source that has finished processing.")
        job = job_pipeline.create(s, asset, params)
        return ok(id=job.id, status=job.status,
                  coverage=body.coverage, clip_count=body.clip_count)


class ConfirmBody(BaseModel):
    clip_count: int


@router.patch("/v1/autoclip/{job_id}")
def confirm_count(job_id: str, body: ConfirmBody) -> dict:
    with session() as s:
        job = s.get(Job, job_id)
        if not job:
            raise EngineError("NOT_FOUND", "No job with that id.")
        if job.status != "awaiting_confirmation":
            raise EngineError("VALIDATION_ERROR", "That job is not waiting for a clip count.")
        job.suggested_count = max(1, min(60, body.clip_count))
        job.status = "processing"
        job.stage = "finding"
        s.add(job)
        s.commit()
        return ok(_job_payload(s, job))


@router.get("/v1/autoclip")
def list_jobs() -> dict:
    with session() as s:
        rows = s.exec(select(Job).order_by(Job.created_at.desc()).limit(50)).all()  # type: ignore[attr-defined]
        return ok(autoclips=[_job_payload(s, j) for j in rows])


@router.get("/v1/autoclip/{job_id}")
def get_job(job_id: str) -> dict:
    with session() as s:
        job = s.get(Job, job_id)
        if not job:
            raise EngineError("NOT_FOUND", "No job with that id.")
        return ok(_job_payload(s, job))


def _job_payload(s, job: Job) -> dict:
    return {"id": job.id, "status": job.status, "stage": job.stage or None, "progress": job.progress,
            "coverage": (job.params or {}).get("coverage", "best"),
            "clip_count": (job.params or {}).get("clip_count", "auto"),
            "suggested_count": job.suggested_count, "skipped": job.skipped,
            "processing_s": job.processing_s, "error": job.error or None,
            "finder_note": (job.params or {}).get("finder_note") or None,
            "created_at": job.created_at.isoformat(),
            "clips": job_pipeline.clips_payload(s, job.id)}


# ------------------------------------------------------------------ projects

@router.get("/v1/projects/{project_id}")
def get_project(project_id: str) -> dict:
    with session() as s:
        p = s.get(Project, project_id)
        if not p or p.deleted_at:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        return ok(_project_payload(p, s))


class PatchBody(BaseModel):
    in_ms: int | None = None
    out_ms: int | None = None
    aspect: str | None = None
    layout: str | None = None
    framing: dict | None = None
    caption_style_id: str | None = None
    caption_options: dict | None = None
    captions: list[dict] | None = None
    title: dict | None = None
    watermark: dict | None = None
    edits: dict | None = None
    background: dict | None = None


@router.patch("/v1/projects/{project_id}")
def patch_project(project_id: str, body: PatchBody) -> dict:
    with session() as s:
        p = s.get(Project, project_id)
        if not p or p.deleted_at:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        data = {k: v for k, v in body.model_dump().items() if v is not None}
        _check_edit(data)
        # Partial dictionaries merge: sending {"zoom": "off"} must not drop
        # the focus the finder chose, nor {"position": "top"} the censored words.
        for key in ("framing", "caption_options", "title"):
            if key in data and isinstance(data[key], dict):
                data[key] = {**(getattr(p, key) or {}), **data[key]}
        if "in_ms" in data or "out_ms" in data:
            new_in = data.get("in_ms", p.in_ms)
            new_out = data.get("out_ms", p.out_ms)
            if new_out <= new_in:
                raise EngineError("VALIDATION_ERROR", "The clip has to end after it starts.")
            own = s.get(Asset, p.asset_id)
            length_ms = round((own.length_s if own else 0) * 1000)
            if new_in < 0 or (length_ms and new_out > length_ms):
                raise EngineError("VALIDATION_ERROR", "A clip can't run past the video it was cut from.")
            if (new_in, new_out) != (p.in_ms, p.out_ms):
                # the words move with the clip
                from ..models import Transcript as T
                from ..pipeline.transcribe import slice_words

                transcript = s.exec(select(T).where(T.asset_id == p.asset_id)).first()
                if transcript and "captions" not in data:
                    data["captions"] = slice_words(list(transcript.words), new_in, new_out)
        # A preview of the old settings would be a lie, so drop it and let the
        # next open cut a fresh one.
        if RENDER_FIELDS & set(data):
            p.preview_key = ""
        for key, value in data.items():
            setattr(p, key, value)
        s.add(p)
        s.commit()
        s.refresh(p)
        return ok(_project_payload(p, s))


@router.delete("/v1/projects/{project_id}")
def delete_project(project_id: str) -> dict:
    with session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        from ..models import utcnow

        p.deleted_at = utcnow()
        s.add(p)
        s.commit()
    return ok()


#: Anything that changes what a render looks like. A cached preview of a clip
#: is only valid while none of these have moved.
RENDER_FIELDS = {"in_ms", "out_ms", "aspect", "layout", "framing", "caption_style_id",
                 "caption_options", "captions", "title", "watermark", "background"}


class PreviewBody(PatchBody):
    """Settings to try without saving them. Empty means the clip as it is."""


@router.post("/v1/projects/{project_id}/preview")
def make_preview(project_id: str, body: PreviewBody | None = None) -> dict:
    overrides = {k: v for k, v in (body.model_dump() if body else {}).items() if v is not None}
    _check_edit(overrides)
    with session() as s:
        p = s.get(Project, project_id)
        if not p or p.deleted_at:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        if overrides:
            # The editor trying a layout: a one-off, never the remembered preview.
            return ok(preview_url=export_pipeline.preview(s, p, overrides=overrides), saved=False)
        # Hand back the one already cut. Rendering is seconds of CPU even at
        # preview quality, and this runs inside the request while the worker
        # may be rendering the same clip for export. Any edit clears the key
        # (see patch_project), so a cached preview is never a stale one.
        if p.preview_key:
            return ok(preview_url=storage.public_url(p.preview_key), saved=True)
        return ok(preview_url=export_pipeline.preview(s, p), saved=True)


@router.get("/v1/projects/{project_id}/framing")
def project_framing(project_id: str, aspect: str = "", layout: str = "", zoom: str = "") -> dict:
    """The shot list this clip renders with, so the editor can draw it.

    Shot by shot: kind (fill, fit, split, grid, screen, pip, bars, headline,
    feed), the crop boxes in source pixels and where a fill crop pans. Pass
    `aspect`, `layout` or `zoom` to see what a different choice would do.
    The analysis behind this is cached per source and range, so asking for it
    costs nothing after the first clip of a video.
    """
    with session() as s:
        p = s.get(Project, project_id)
        if not p or p.deleted_at:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        want = aspect or p.aspect
        overrides: dict = {"aspect": want}
        if layout:
            overrides["layout"] = layout
        if zoom:
            overrides["framing"] = {"zoom": zoom}
        _check_edit(overrides)
        source = s.get(Asset, p.asset_id)
        if not source:
            raise EngineError("NOT_FOUND", "The source for that clip no longer exists.")
        path = storage.local_path(source.mezzanine_key or source.storage_key)
        render = export_pipeline.render_for(p, path, path.with_suffix(".plan.mp4"), overrides=overrides)
        plan, inputs = compose.plan_for(render)
        track = inputs.track
        faces = [{"x": f.x, "y": f.y, "w": f.w, "h": f.h, "share": f.share}
                 for f in getattr(track, "faces", [])]
        return ok(aspect=want, layout=render.layout, zoom=render.zoom, focus=render.focus,
                  source={"w": inputs.width, "h": inputs.height},
                  output={"w": inputs.out_w, "h": inputs.out_h},
                  strategy=getattr(track, "strategy", "none"),
                  seam=framing.seam_of(track) if track is not None else None,
                  faces=faces, people=len(inputs.tracks), cuts=[c - p.in_ms for c in inputs.cuts],
                  shots=[sh.as_dict(p.in_ms) for sh in plan],
                  summary={k: v for k, v in sorted(compose.shotplan.summary(plan).items(), key=lambda kv: -kv[1])})


class ExportBody(BaseModel):
    resolution: str = "1080p"


@router.post("/v1/projects/{project_id}/export")
def export_project(project_id: str, body: ExportBody) -> dict:
    if body.resolution not in {"1080p", "2160p"}:
        raise EngineError("VALIDATION_ERROR", "resolution must be 1080p or 2160p.")
    with session() as s:
        p = s.get(Project, project_id)
        if not p or p.deleted_at:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        row = export_pipeline.create(s, p, body.resolution)
        return ok(id=row.id, project_id=p.id, status=row.status)


@router.get("/v1/exports/{export_id}")
def get_export(export_id: str) -> dict:
    with session() as s:
        row = s.get(Export, export_id)
        if not row:
            raise EngineError("NOT_FOUND", "No export with that id.")
        payload = {"id": row.id, "project_id": row.project_id, "status": row.status,
                   "progress": row.progress, "error": row.error or None,
                   "created_at": row.created_at.isoformat()}
        asset = s.get(Asset, row.asset_id) if row.asset_id else None
        if asset:
            from ..pipeline.ingest import asset_payload

            # the finished file sits under "asset", as the export.completed event does
            payload["asset"] = asset_payload(asset)
        return ok(payload)


@router.get("/v1/projects/{project_id}/captions")
def project_captions(project_id: str, format: str = "srt") -> dict:
    if format not in {"srt", "vtt", "txt"}:
        raise EngineError("VALIDATION_ERROR", "format must be srt, vtt or txt.")
    with session() as s:
        p = s.get(Project, project_id)
        if not p:
            raise EngineError("NOT_FOUND", "No clip with that id.")
        return ok(format=format, body=_subtitles(list(p.captions or []), format))


def _subtitles(words: list[dict], fmt: str) -> str:
    from ..pipeline.caption import group_lines

    lines = group_lines(words)
    if fmt == "txt":
        return "\n".join(l.text for l in lines)

    def stamp(ms: int) -> str:
        h, rem = divmod(max(0, ms), 3_600_000)
        m, rem = divmod(rem, 60_000)
        sec, milli = divmod(rem, 1000)
        sep = "," if fmt == "srt" else "."
        return f"{h:02d}:{m:02d}:{sec:02d}{sep}{milli:03d}"

    out = [] if fmt == "srt" else ["WEBVTT", ""]
    for i, l in enumerate(lines, start=1):
        if fmt == "srt":
            out.append(str(i))
        out.append(f"{stamp(l.start_ms)} --> {stamp(l.end_ms)}")
        out.append(l.text)
        out.append("")
    return "\n".join(out)


def _project_payload(p: Project, s=None) -> dict:
    source = s.get(Asset, p.asset_id) if s is not None else None
    offset = source.offset_ms if source and source.parent_id else 0
    return {
        # The clip's own source: a fetched section of a long video starts at
        # `source_offset_ms` in the original and is `source_length_ms` long.
        "source_offset_ms": offset,
        "source_length_ms": round((source.length_s if source else 0) * 1000),
        # The clip's own source video, so an editor can preview edits live.
        "source_url": storage.public_url(source.mezzanine_key or source.storage_key)
        if source and (source.mezzanine_key or source.storage_key) else "",
        "id": p.id, "asset_id": p.asset_id, "job_id": p.job_id or None, "index": p.index,
        "in_ms": p.in_ms, "out_ms": p.out_ms, "duration_ms": p.out_ms - p.in_ms,
        "aspect": p.aspect, "layout": p.layout, "framing": p.framing,
        "caption_style_id": p.caption_style_id, "caption_options": p.caption_options,
        "captions": p.captions, "title": p.title, "watermark": p.watermark, "edits": p.edits,
        "background": p.background, "score": p.score, "grades": p.grades,
        "scene_analysis": p.scene_analysis, "reason": p.reason, "faces": p.faces,
        "preview_url": storage.public_url(p.preview_key) if p.preview_key else "",
        "thumbnail_url": storage.public_url(p.thumb_key) if p.thumb_key else "",
        "updated_at": p.updated_at.isoformat(),
    }
