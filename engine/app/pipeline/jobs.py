"""The AutoClip state machine.

queued -> transcribing -> finding -> (awaiting_confirmation) -> [fetching] ->
cutting -> framing -> finalizing -> completed, one stage per worker pass so
progress is real rather than a spinner. Fetching runs only for a lean source
(a long link imported as audio): it downloads the video of each chosen moment.
"""
from __future__ import annotations

import logging
import threading
import time
import uuid
from pathlib import Path

from sqlmodel import Session, select

from .. import media, storage, webhooks
from ..config import settings
from ..db import session as db_session
from ..errors import EngineError
from ..ids import new_id
from ..models import Asset, Job, Project, Transcript, utcnow
from . import find as finder
from . import frame as framing
from .transcribe import slice_words, transcribe

log = logging.getLogger("engine.jobs")

#: Retries across a whole job, for failures that may not happen twice.
MAX_JOB_RETRIES = 2


class JobFailed(RuntimeError):
    """This job can't succeed however often it is tried."""


STAGE_PROGRESS = {"transcribing": 15, "finding": 40, "fetching": 50, "cutting": 60, "framing": 80, "finalizing": 95}
#: A lean source's fetching stage is most of its wait, so it gets most of the
#: bar, moving with the download itself.
FETCH_FROM, FETCH_TO = 35, 82
#: Section downloads that fail before the rest are skipped for one whole download.
SECTION_FAILURES_BEFORE_WHOLE = 2


def create(session: Session, asset: Asset, params: dict) -> Job:
    running = session.exec(
        select(Job).where(Job.status.in_(["queued", "processing"]))  # type: ignore[attr-defined]
    ).all()
    if len(running) >= settings().concurrent_jobs:
        raise EngineError("JOB_LIMIT_REACHED", "Three jobs are already running. Wait for one to finish.")
    job = Job(id=new_id("job"), asset_id=asset.id, params=params, status="queued")
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


# A job stays "processing" across all its stages, so the status can't say who
# is working on it. This set does: a worker adds a job id before touching the
# row and removes it after, and no other worker picks a job that is in it.
# In memory is enough because one Engine process owns the volume (a Fly volume
# attaches to a single machine), and a restart empties it along with the
# workers that held it.
_claimed: set[str] = set()
_claim_lock = threading.Lock()

# Two jobs on the same source must not transcribe it twice at once.
_asset_locks: dict[str, threading.Lock] = {}


def _asset_lock(asset_id: str) -> threading.Lock:
    with _claim_lock:
        return _asset_locks.setdefault(asset_id, threading.Lock())


def _claim(s: Session) -> str | None:
    ids = s.exec(
        select(Job.id).where(Job.status.in_(["queued", "processing"]))  # type: ignore[attr-defined]
        .order_by(Job.created_at)
    ).all()
    with _claim_lock:
        for job_id in ids:
            if job_id not in _claimed:
                _claimed.add(job_id)
                return job_id
    return None


def advance_one() -> bool:
    """Move the oldest unclaimed active job on by one stage. Returns True if anything changed."""
    with db_session() as s:
        job_id = _claim(s)
        if not job_id:
            return False
        try:
            return _advance(s, job_id)
        finally:
            with _claim_lock:
                _claimed.discard(job_id)


def _advance(s: Session, job_id: str) -> bool:
    # Read only after claiming, so the row reflects the last worker's commit.
    job = s.get(Job, job_id)
    if not job or job.status not in ("queued", "processing"):
        return False
    try:
        _step(s, job)
    except Exception as e:
        s.rollback()
        attempts = int((job.params or {}).get("_attempts", 0))
        retryable = not isinstance(e, (JobFailed, EngineError)) or getattr(e, "transient", False)
        if retryable and attempts < MAX_JOB_RETRIES:
            log.warning("job %s failed at %s, retrying: %s", job.id, job.stage, e)
            job.params = {**(job.params or {}), "_attempts": attempts + 1}
            s.add(job)
            s.commit()
            time.sleep(3 * (attempts + 1))
            return True
        job.status = "failed"
        job.error = str(e)[:500]
        s.add(job)
        s.commit()
        webhooks.emit("autoclip.failed", {"autoclip_id": job.id, "error": job.error})
    return True


def _step(s: Session, job: Job) -> None:
    started = time.time()
    if job.status == "queued":
        job.status = "processing"
        job.stage = "transcribing"
        job.progress = 5
        s.add(job)
        s.commit()
        return

    asset = s.get(Asset, job.asset_id)
    if not asset:
        raise JobFailed("the source for this job has gone")
    params = job.params or {}

    if job.stage == "transcribing":
        _ensure_transcript(s, asset, params)
        job.stage = "finding"
        job.progress = STAGE_PROGRESS["finding"]
        s.add(job)
        s.commit()
        return

    if job.stage == "finding":
        moments = _find(s, job, asset, params)
        if moments is None:          # paused, waiting for a count
            return
        job.params = {**params, "_moments": [m.__dict__ for m in moments]}
        job.stage = "fetching" if asset.lean else "cutting"
        job.progress = FETCH_FROM if asset.lean else STAGE_PROGRESS[job.stage]
        s.add(job)
        s.commit()
        return

    if job.stage == "fetching":
        _fetch_sections(s, job, asset)
        job.stage = "cutting"
        job.progress = STAGE_PROGRESS["cutting"]
        s.add(job)
        s.commit()
        return

    if job.stage == "cutting":
        _cut(s, job, asset, params)
        job.stage = "framing"
        job.progress = STAGE_PROGRESS["framing"]
        s.add(job)
        s.commit()
        return

    if job.stage == "framing":
        _frame(s, job, asset)
        job.stage = "finalizing"
        job.progress = STAGE_PROGRESS["finalizing"]
        s.add(job)
        s.commit()
        return

    if job.stage == "finalizing":
        if not clips_payload(s, job.id):
            raise JobFailed("No usable moments were found. Try Clip anything or choose a different range.")
        job.status = "completed"
        job.progress = 100
        job.processing_s = round(job.processing_s + (time.time() - started), 2)
        job.params = {k: v for k, v in (job.params or {}).items() if not k.startswith("_")}
        s.add(job)
        s.commit()
        webhooks.emit("autoclip.completed", {
            "autoclip_id": job.id,
            "source_name": _source_name(s, job),
            "processing_seconds": round(job.processing_s),
            "finder_note": (job.params or {}).get("finder_note") or None,
            # full: the app writes these onto each clip so the editor opens
            # ready — captions, title, watermark and layout already in place.
            "clips": clips_payload(s, job.id, full=True),
        })
        return


def _ensure_transcript(s: Session, asset: Asset, params: dict) -> Transcript:
    with _asset_lock(asset.id):
        return _transcribe_once(s, asset, params)


def _transcribe_once(s: Session, asset: Asset, params: dict) -> Transcript:
    # populate_existing: another job may have finished it while we waited.
    existing = s.exec(select(Transcript).where(Transcript.asset_id == asset.id)
                      .execution_options(populate_existing=True)).first()
    if existing and existing.status == "ready":
        return existing
    row = existing or Transcript(id=new_id("trn"), asset_id=asset.id)
    row.status = "processing"
    s.add(row)
    s.commit()
    started = time.time()
    source = storage.local_path(asset.mezzanine_key or asset.storage_key)
    audio = source.with_name(f"{source.stem}.{uuid.uuid4().hex[:8]}.16k.wav")
    media.extract_audio(source, audio)
    result = transcribe(audio, asset.length_s, params.get("vocabulary") or [], params.get("language"))
    audio.unlink(missing_ok=True)
    words, sentences = result.as_dicts()
    row.words, row.sentences = words, sentences
    row.language, row.model = result.language, result.model
    row.status = "ready"
    row.processing_s = round(time.time() - started, 2)
    s.add(row)
    s.commit()
    webhooks.emit("transcript.completed", {"transcript_id": row.id, "asset_id": asset.id})
    return row


def _target_ms(params: dict, asset: Asset) -> int:
    length = params.get("clip_length", "auto")
    if isinstance(length, (int, float)):
        return int(length) * 1000
    if isinstance(length, dict):
        return int((length.get("min_s", 45) + length.get("max_s", 90)) / 2 * 1000)
    return 60_000


def _find(s: Session, job: Job, asset: Asset, params: dict) -> list[finder.Moment] | None:
    transcript = s.exec(select(Transcript).where(Transcript.asset_id == asset.id)).first()
    sentences = list(transcript.sentences) if transcript else []
    coverage = params.get("coverage", "best")
    target = _target_ms(params, asset)

    start_ms = int(params.get("range_start_ms") or 0)
    end_ms = int(params.get("range_end_ms") or asset.length_s * 1000)
    if start_ms or end_ms < asset.length_s * 1000:
        sentences = [x for x in sentences if x["end_ms"] > start_ms and x["start_ms"] < end_ms]

    requested = params.get("clip_count", "auto")
    if requested == "auto":
        suggested = finder.suggest_count(end_ms - start_ms, coverage, target)
        if params.get("confirm_count") and job.suggested_count is None:
            job.suggested_count = suggested
            job.status = "awaiting_confirmation"
            job.stage = ""
            job.progress = 25
            s.add(job)
            s.commit()
            webhooks.emit("autoclip.awaiting_confirmation", {
                "autoclip_id": job.id,
                "suggested_count": suggested,
                "source_name": _source_name(s, job),
            })
            return None
        count = job.suggested_count or suggested
    else:
        count = int(requested)

    envelope: list[float] = []
    report: dict = {}
    mode = params.get("mode", "auto")
    if mode in {"energy", "visual"} or (mode == "auto" and not sentences):
        envelope = media.loudness_envelope(storage.local_path(asset.mezzanine_key or asset.storage_key))

    from . import replay

    curve = replay.for_asset(asset) if params.get("use_replay", True) else None
    moments = finder.find(
        sentences if mode != "visual" else [], count=count, target_ms=target, replay_curve=curve,
        mode="energy" if mode == "visual" else mode,
        coverage=coverage, genre=params.get("genre", "auto"), prompt=params.get("prompt", ""),
        must_include=params.get("must_include") or [], keep_qa=params.get("keep_qa", True),
        title_brief=params.get("title_brief", ""), envelope=envelope, report=report,
    )
    if report.get("note"):
        job.params = {**(job.params or {}), "finder_note": report["note"]}
    # Sparse speech can yield sentences but no viable speech-sized clip. Auto
    # must then use the real source's audio peaks, not finish with zero projects.
    if not moments and mode == "auto":
        envelope = envelope or media.loudness_envelope(
            storage.local_path(asset.mezzanine_key or asset.storage_key))
        moments = finder.energy_find(envelope, count, target)
    bounded: list[finder.Moment] = []
    for moment in moments:
        moment.start_ms = max(start_ms, moment.start_ms)
        moment.end_ms = min(end_ms, moment.end_ms)
        if moment.duration_ms < 2000:
            continue
        if any(moment.start_ms < other.end_ms and other.start_ms < moment.end_ms for other in bounded):
            continue
        bounded.append(moment)
    moments = bounded
    if not moments:
        raise JobFailed("No usable moments were found. Try Clip anything or choose a different range.")
    if coverage == "whole":
        covered = [{"start_ms": m.start_ms, "end_ms": m.end_ms} for m in moments]
        job.skipped = _gaps(covered, start_ms, end_ms)
    return moments


def _gaps(covered: list[dict], start_ms: int, end_ms: int, min_gap: int = 4000) -> list[dict]:
    out: list[dict] = []
    cursor = start_ms
    for c in sorted(covered, key=lambda x: x["start_ms"]):
        if c["start_ms"] - cursor >= min_gap:
            out.append({"start_ms": cursor, "end_ms": c["start_ms"], "kind": "dead_air"})
        cursor = max(cursor, c["end_ms"])
    if end_ms - cursor >= min_gap:
        out.append({"start_ms": cursor, "end_ms": end_ms, "kind": "outro"})
    return out


def _cut(s: Session, job: Job, asset: Asset, params: dict) -> None:
    # Cutting is the one stage that creates rows, so it is the one stage where
    # running twice is visible: the job would deliver double the clips asked
    # for. If this job already has its clips, the stage has already run.
    if s.exec(select(Project).where(Project.job_id == job.id)).first():
        return
    moments = [finder.Moment(**m) for m in (job.params or {}).get("_moments", [])]
    transcript = s.exec(select(Transcript).where(Transcript.asset_id == asset.id)).first()
    words = list(transcript.words) if transcript else []
    sections = (job.params or {}).get("_sections") or {}
    formats = params.get("formats") or ["full-video"]
    for i, m in enumerate(moments, start=1):
        # A lean source's clip lives on its own section, timed from the section's start.
        source_id, shift, clip_words = asset.id, 0, words
        section = s.get(Asset, sections.get(str(i - 1), "")) if sections else None
        if section:
            source_id, shift = section.id, section.offset_ms
            section_words = s.exec(select(Transcript).where(Transcript.asset_id == section.id)).first()
            clip_words = list(section_words.words) if section_words else []
        project = Project(
            id=new_id("prj"), asset_id=source_id, job_id=job.id, index=i,
            in_ms=max(0, m.start_ms - shift), out_ms=m.end_ms - shift,
            aspect=params.get("aspect", "9:16"), layout=formats[0],
            caption_style_id=params.get("caption_style_id") or "bold_white",
            caption_options={"enabled": params.get("edit_level", "full") != "clips",
                             **({"position": params["caption_position"]} if params.get("caption_position") else {}),
                             **({"size": params["caption_size"]} if params.get("caption_size") else {})},
            framing={"mode": params.get("framing", "auto"), "focus": m.focus,
                     "zoom": params.get("zoom") or "auto"},
            edits=params.get("edits") or {},
            score=m.score, grades=m.grades, scene_analysis=m.scene_analysis, reason=m.reason,
            title={"text": m.title, "style": params.get("title_style") or "bold_band",
                   "enabled": params.get("title_enabled", True),
                   "auto": bool(params.get("headline_top_n", 0) and i <= int(params.get("headline_top_n", 0)))},
            captions=slice_words(clip_words, max(0, m.start_ms - shift), m.end_ms - shift),
        )
        s.add(project)
    s.commit()


def _frame(s: Session, job: Job, asset: Asset) -> None:
    """One thumbnail per clip, plus the faces the tracker saw."""
    projects = s.exec(select(Project).where(Project.job_id == job.id)).all()
    for p in projects:
        own = asset if p.asset_id == asset.id else (s.get(Asset, p.asset_id) or asset)
        source = storage.local_path(own.mezzanine_key)
        mid_s = (p.in_ms + (p.out_ms - p.in_ms) / 2) / 1000
        key = f"thumbs/{p.id}.jpg"
        try:
            media.thumbnail(source, storage.open_write(key), mid_s, width=540)
            storage.put_file(storage.open_write(key), key, "image/jpeg")
            p.thumb_key = key
        except Exception:
            p.thumb_key = asset.thumb_key
        s.add(p)
    s.commit()


def _source_name(s: Session, job: Job) -> str:
    """What the creator will see named in the notification."""
    asset = s.get(Asset, job.asset_id)
    return (asset.name if asset else "") or "your video"


def clips_payload(s: Session, job_id: str, full: bool = False) -> list[dict]:
    projects = s.exec(select(Project).where(Project.job_id == job_id).order_by(Project.index)).all()
    return [project_summary(p, full=full, offset_ms=source_offset(s, p)) for p in projects]


def _progress_reporter(job_id: str, lo: int, hi: int):
    """A callback that moves the job's progress between lo and hi (0..1 in).

    It writes through its own session, so download threads can call it, and
    only when the whole-number percentage changes.
    """
    last = {"value": -1}

    def report(fraction: float) -> None:
        value = int(lo + (hi - lo) * max(0.0, min(1.0, fraction)))
        if value <= last["value"]:
            return
        last["value"] = value
        try:
            with db_session() as s:
                row = s.get(Job, job_id)
                if row and row.status == "processing" and row.progress < value:
                    row.progress = value
                    s.add(row)
                    s.commit()
        except Exception:  # noqa: BLE001 - progress is a nicety, never a failure
            pass

    return report


def source_offset(s: Session, p: Project) -> int:
    """Where a clip's own source starts in the original video (0 unless a section)."""
    own = s.get(Asset, p.asset_id)
    return own.offset_ms if own and own.parent_id else 0


def _fetch_sections(s: Session, job: Job, asset: Asset) -> None:
    """The video around each chosen moment, as one section asset per clip.

    Downloads run side by side; each section is then placed exactly by its
    audio and gets its own slice of the transcript, so the cutting stage and
    everything after it (previews, trims, renders) work on it like any source.
    """
    from concurrent.futures import ThreadPoolExecutor

    from . import ingest, lean

    params = job.params or {}
    if params.get("_sections"):
        return
    moments = [finder.Moment(**m) for m in params.get("_moments", [])]
    length_ms = round(asset.length_s * 1000)
    plan = lean.plan_sections([(m.start_ms, m.end_ms) for m in moments], length_ms)
    full_audio = storage.local_path(asset.storage_key)
    base = asset.name or "video"
    rows = []
    for sec in plan:
        row = Asset(id=new_id("ast"), name=f"{base} (clip {sec.index + 1})", type="video",
                    category="section", status="importing", source_url=asset.source_url,
                    rights_confirmed=True, parent_id=asset.id, offset_ms=sec.start_ms)
        # Named by the section, not the new row, so a retried job finds what an
        # earlier try already downloaded (seen live: a retry re-fetched all 20,
        # including the 4 that had arrived).
        row.storage_key = f"sources/{asset.id}/sections/{sec.start_ms}-{sec.end_ms}.mp4"
        rows.append((sec, row))

    report = _progress_reporter(job.id, FETCH_FROM, FETCH_TO)
    lock = threading.Lock()
    tally = {"done": 0, "failed": 0}
    give_up = threading.Event()

    def fetch(item: tuple) -> tuple:
        sec, row = item
        dest = storage.open_write(row.storage_key)
        if lean.has_video(dest):
            with lock:
                tally["done"] += 1
            report(tally["done"] / max(1, len(rows)))
            return sec, row, dest, None
        if give_up.is_set():
            return sec, row, dest, RuntimeError("skipped: sections were failing")
        try:
            ingest.fetch_section(asset.source_url, dest, sec.start_ms, sec.end_ms)
            if not lean.has_video(dest):
                raise RuntimeError("the section came without a picture")
            with lock:
                tally["done"] += 1
            report(tally["done"] / max(1, len(rows)))
            return sec, row, dest, None
        except Exception as e:  # noqa: BLE001 - every failure is retried from one whole download below
            dest.unlink(missing_ok=True)
            with lock:
                tally["failed"] += 1
                if tally["failed"] >= SECTION_FAILURES_BEFORE_WHOLE:
                    give_up.set()
            return sec, row, dest, e

    workers = max(1, min(settings().section_downloads, len(rows)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(fetch, rows))

    # A section download can fail where a whole one works: ffmpeg opens a new
    # connection per piece, and through a rotating proxy each lands on another
    # address, which YouTube refuses for a link it gave a different one. One
    # whole download keeps one connection, so the missing sections are cut
    # from that instead of failing the job.
    failed = [r for r in results if r[3] is not None]
    if failed:
        log.warning("%d of %d sections of %s failed (%s); cutting them from one whole download",
                    len(failed), len(results), asset.source_url, failed[0][3])
        whole = storage.open_write(f"sources/{asset.id}/download.mp4")
        if not lean.has_video(whole):
            # The bar carries on from where the sections left it, to the end of the stage.
            done_share = (len(results) - len(failed)) / max(1, len(results))
            moving = _progress_reporter(job.id, FETCH_FROM + round((FETCH_TO - FETCH_FROM) * done_share), FETCH_TO)
            ingest.download_whole(asset.source_url, whole, moving)
        for sec, _row, dest, _err in failed:
            lean.cut_copy(whole, dest, sec.start_ms, sec.end_ms)
    fetched = [(sec, row, dest, lean.measure_offset(full_audio, dest, sec.start_ms)) for sec, row, dest, _err in results]

    transcript = s.exec(select(Transcript).where(Transcript.asset_id == asset.id)).first()
    words = list(transcript.words) if transcript else []
    sentences = list(transcript.sentences) if transcript else []
    mapping: dict[str, str] = {}
    for sec, row, dest, offset in fetched:
        row.offset_ms = offset
        s.add(row)
        s.commit()
        ingest.ingest_video(s, row, dest)
        end_ms = offset + round(row.length_s * 1000)
        s.add(Transcript(id=new_id("trn"), asset_id=row.id, status="ready",
                         language=transcript.language if transcript else "",
                         model=transcript.model if transcript else "",
                         words=lean.rebase(words, offset, offset, end_ms),
                         sentences=lean.rebase(sentences, offset, offset, end_ms)))
        mapping[str(sec.index)] = row.id
    job.params = {**params, "_sections": mapping}
    s.add(job)
    s.commit()


def project_summary(p: Project, full: bool = False, offset_ms: int = 0) -> dict:
    """What a finished clip looks like to the app.

    `full` adds everything needed to open the clip in the editor without any
    further work: the words with their timings, the caption style, the title,
    the watermark and the framing. All of it was computed while the source was
    being processed, so handing it over now is what stops the app asking the
    person to transcribe a clip the Engine already transcribed.

    It is off by default because the app polls this same shape while a job
    runs, and the words are by far the largest part of it.
    """
    out = {
        "project_id": p.id, "index": p.index, "title": (p.title or {}).get("text", ""),
        "start_ms": p.in_ms, "end_ms": p.out_ms, "duration_ms": p.out_ms - p.in_ms,
        # Where the clip sits in the original video; differs from start_ms
        # only when the clip was made from a fetched section.
        "source_start_ms": p.in_ms + offset_ms, "source_end_ms": p.out_ms + offset_ms,
        "thumbnail_url": storage.public_url(p.thumb_key) if p.thumb_key else "",
        "score": p.score, "grades": p.grades, "scene_analysis": p.scene_analysis,
        "reason": p.reason, "alternate_of": p.alternate_of or None,
        "faces": p.faces or [],
    }
    if full:
        out["finish"] = {
            # Word-level, already re-based so the clip starts at zero.
            "captions": list(p.captions or []),
            "caption_style_id": p.caption_style_id or "",
            "caption_options": p.caption_options or {},
            "title_text": (p.title or {}).get("text", ""),
            "title_style": (p.title or {}).get("style", "") or "bold_band",
            "watermark": p.watermark or {},
            "aspect": p.aspect or "",
            "layout": p.layout or "",
            "framing": p.framing or {},
        }
    return out
