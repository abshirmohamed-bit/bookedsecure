"""Getting a video into the Engine: uploads and link imports."""
from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path

from sqlmodel import Session

from .. import media, storage, webhooks
from ..config import settings
from ..errors import EngineError, TransientFetch
from ..models import Asset, utcnow
from . import proxy_health

log = logging.getLogger("engine.ingest")

VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-msvideo",
               "video/x-m4v", "video/mpeg", "video/x-ms-wmv", "video/x-flv", "video/3gpp"}
AUDIO_TYPES = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/aac", "audio/ogg",
               "audio/webm", "audio/flac"}
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
FONT_TYPES = {"font/ttf", "font/otf", "font/woff2", "application/x-font-ttf"}
SUB_TYPES = {"application/x-subrip", "text/vtt", "text/plain"}

# page hosts the importer will resolve with yt-dlp
IMPORT_HOSTS = ("youtube.com", "youtu.be", "rumble.com", "vimeo.com", "twitch.tv", "facebook.com",
                "x.com", "twitter.com", "tiktok.com", "instagram.com", "drive.google.com",
                "dropbox.com", "zoom.us")



def link_format(max_height: int | None = None) -> str:
    """yt-dlp's format choice for a linked video, capped at `max_height`.

    Plain H.264 files come first: YouTube's "Premium" 1080p is an HLS stream
    of about 3x the size for no visible gain in a clip, and every byte goes
    through the paid proxy. Widening fallbacks, kept from Lovable's fix:
    YouTube offers a server a thinner format list than a browser, so the
    capped choices come first and an uncapped one is only the last resort.
    """
    h = max_height or max_link_height()
    plain = "[protocol^=http]"  # a plain file, not YouTube's HLS "Premium" stream (several times the size)
    return (f"bv*[height<={h}][vcodec^=avc1]{plain}+ba[ext=m4a]/"   # H.264: the smallest to decode, cut and re-encode
            f"bv*[height<={h}]{plain}+ba/b[height<={h}]{plain}/"
            f"bv*[height<={h}]+ba/b[height<={h}]/bv*+ba/b")


def max_link_height() -> int:
    try:
        h = int((os.environ.get("YTDLP_MAX_HEIGHT") or "").strip() or 1080)
    except ValueError:
        h = 1080
    return min(max(h, 360), 2160)

def kind_for(content_type: str) -> str:
    if content_type in VIDEO_TYPES:
        return "video"
    if content_type in AUDIO_TYPES:
        return "audio"
    if content_type in IMAGE_TYPES:
        return "image"
    if content_type in FONT_TYPES:
        return "font"
    if content_type in SUB_TYPES:
        return "subtitles"
    raise EngineError("UNSUPPORTED_MEDIA_TYPE", f"The Engine does not accept {content_type or 'that file type'}.")


def limit_for(kind: str) -> int:
    cfg = settings()
    return {"video": cfg.max_upload_bytes, "audio": 100 * 1024**2, "image": 20 * 1024**2,
            "font": 5 * 1024**2, "subtitles": 2 * 1024**2}[kind]


def needs_rights(url: str) -> bool:
    low = url.lower()
    return any(host in low for host in IMPORT_HOSTS)


def ingest_video(session: Session, asset: Asset, src: Path) -> Asset:
    """Probe, thumbnail and normalise. The mezzanine keeps the source resolution."""
    info = media.probe(src)
    cfg = settings()
    if info.duration_s < cfg.min_source_seconds:
        raise EngineError("VALIDATION_ERROR",
                          f"That video is {info.duration_s:.0f}s; the minimum is {cfg.min_source_seconds}s.")
    if info.duration_s > cfg.max_source_seconds:
        raise EngineError("VALIDATION_ERROR",
                          f"That video is longer than the {cfg.max_source_seconds // 3600}h limit.")

    thumb_key = f"thumbs/{asset.id}.jpg"
    media.thumbnail(src, storage.open_write(thumb_key), info.duration_s * 0.1)
    storage.put_file(storage.open_write(thumb_key), thumb_key, "image/jpeg")

    mezz_key = f"mezzanine/{asset.id}.mp4"
    if info.vcodec in media.COPYABLE:
        media.remux_copy(src, storage.open_write(mezz_key))
        storage.put_file(storage.open_write(mezz_key), mezz_key, "video/mp4")
    elif info.needs_mezzanine:
        media.make_mezzanine(src, storage.open_write(mezz_key))
        storage.put_file(storage.open_write(mezz_key), mezz_key, "video/mp4")
    else:
        dest = storage.open_write(mezz_key)
        if src.resolve() != dest.resolve():
            shutil.copy2(src, dest)
        storage.put_file(dest, mezz_key, "video/mp4")

    asset.mezzanine_key = mezz_key
    asset.thumb_key = thumb_key
    asset.length_s = round(info.duration_s, 3)
    asset.width, asset.height, asset.fps = info.width, info.height, round(info.fps, 3)
    asset.size_bytes = info.size_bytes
    asset.quality_warning = info.height < 1080
    asset.status = "ready"
    session.add(asset)
    session.commit()
    webhooks.emit("asset.imported", asset_event(asset))
    return asset


def import_url(session: Session, asset: Asset, url: str, *, can_retry: bool = False) -> Asset:
    """Direct media URL, or a page the Engine resolves with yt-dlp.

    Called by the worker, not by a request handler: this can take minutes.
    A passing failure with retries left is raised without marking the asset
    failed, so the worker can queue it again.
    """
    try:
        return _import_url(session, asset, url)
    except Exception as e:
        if not (can_retry and getattr(e, "transient", False)):
            mark_failed(session, asset, e)
        raise


def mark_failed(session: Session, asset: Asset, exc: Exception) -> None:
    """An import that dies leaves a row behind; say so instead of leaving it spinning."""
    asset.status = "failed"
    asset.error = (getattr(exc, "message", None) or str(exc))[:500]
    session.add(asset)
    session.commit()
    webhooks.emit("asset.failed", {"asset_id": asset.id, "error": asset.error})


def _import_url(session: Session, asset: Asset, url: str) -> Asset:
    dest = storage.open_write(f"sources/{asset.id}/download.mp4")
    # A killed encode can leave a complete download. Validate before reusing;
    # never treat a partial download as a successful source.
    downloaded = False
    if dest.exists():
        try:
            media.probe(dest)
            downloaded = True
        except Exception:
            dest.unlink(missing_ok=True)
    if needs_rights(url):
        if not asset.rights_confirmed:
            raise EngineError("RIGHTS_REQUIRED", "Confirm you own this footage or have the rights to clip it.")
        if not downloaded:
            lean = _lean_import(session, asset, url)
            if lean is not None:
                return lean
            _ytdlp(url, dest)
    else:
        if not downloaded:
            _download(url, dest)
    asset.storage_key = f"sources/{asset.id}/download.mp4"
    asset.source_url = url
    return ingest_video(session, asset, dest)


def _download(url: str, dest: Path) -> None:
    import httpx

    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
        if r.status_code >= 400:
            raise EngineError("VALIDATION_ERROR", f"That URL returned {r.status_code}.")
        ctype = r.headers.get("content-type", "").split(";")[0]
        if ctype and not ctype.startswith(("video/", "application/octet-stream")):
            raise EngineError("UNSUPPORTED_MEDIA_TYPE", f"That URL serves {ctype}, not a video file.")
        with dest.open("wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)


#: The yt-dlp route (player client, through the proxy?) that last worked for a
#: link. A section of the same video then goes that way first instead of
#: being refused four times again.
_ROUTES: dict[str, tuple[str, bool]] = {}


def _run_with_progress(cmd: list[str], timeout: int, on_progress) -> "subprocess.CompletedProcess":
    """subprocess.run, but reading yt-dlp's progress lines as they come.

    A merged download is two files, the picture then the sound; the picture
    is most of the bytes, so it counts for 90% of the bar.
    """
    import re
    import subprocess
    import threading

    pct_re = re.compile(r"\[download\]\s+([\d.]+)%")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)
    state = {"file": 0, "last": 0.0}
    out: list[str] = []

    def read() -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            out.append(line)
            m = pct_re.search(line)
            if not m:
                continue
            p = float(m.group(1)) / 100
            if p + 0.2 < state["last"]:
                state["file"] += 1      # the next file (the sound) started
            state["last"] = p
            overall = 0.9 * p if state["file"] == 0 else min(1.0, 0.9 + 0.1 * p)
            try:
                on_progress(overall)
            except Exception:  # noqa: BLE001 - progress is a nicety, never a failure
                pass

    errs: list[str] = []

    def read_err() -> None:
        errs.append(proc.stderr.read())  # type: ignore[union-attr]

    readers = [threading.Thread(target=read, daemon=True), threading.Thread(target=read_err, daemon=True)]
    for r in readers:
        r.start()
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise
    for r in readers:
        r.join(timeout=5)
    return subprocess.CompletedProcess(cmd, proc.returncode, "".join(out), "".join(errs))


def run_ytdlp(url: str, dest: Path, args: list[str], timeout: int = 1800, max_routes: int | None = None,
              on_progress=None, kind: str = "whole") -> None:
    """yt-dlp with every route tried in turn, the one that last worked first.

    A run that goes past `timeout` is stopped and counts as failed; it is
    never retried on another route, because a stalled transfer stalls the
    same way again. `max_routes` caps how many routes are tried at all.
    """
    import subprocess

    exe = shutil.which("yt-dlp")
    if not exe:
        raise EngineError("NOT_CONFIGURED", "yt-dlp is not installed, so page links cannot be resolved.")
    from . import ytdlp_opts

    dest.parent.mkdir(parents=True, exist_ok=True)
    routes = ytdlp_opts.attempts()
    known = _ROUTES.get(url)
    if known in routes:
        routes = [known] + [r for r in routes if r != known]
    if max_routes:
        routes = routes[:max_routes]
    last = ""
    for client, via_proxy in routes:
        cmd = [exe, "--no-playlist", "--quiet", "--no-warnings", *(["--newline", "--progress"] if on_progress else []),
               *ytdlp_opts.cli_args(client, via_proxy), *args, "-o", str(dest), "--", url]
        started = time.time()
        mode = proxy_health.mode_of(ytdlp_opts.proxy())
        try:
            proc = (_run_with_progress(cmd, timeout, on_progress) if on_progress
                    else subprocess.run(cmd, capture_output=True, text=True, timeout=timeout))
        except subprocess.TimeoutExpired:
            proxy_health.record(kind=kind, via_proxy=via_proxy, mode=mode, outcome="stalled",
                                bytes_=_size(dest), seconds=time.time() - started)
            log.warning("yt-dlp took over %ss for %s as %s%s; stopping it", timeout, url, client, " via proxy" if via_proxy else "")
            raise EngineError("VALIDATION_ERROR", f"Downloading from that link stalled for over {timeout // 60} minutes.") from None
        proxy_health.record(kind=kind, via_proxy=via_proxy, mode=mode,
                            outcome=proxy_health.outcome_of(0 if proc.returncode == 0 and dest.exists() else (proc.returncode or 1), proc.stderr or ""),
                            bytes_=_size(dest) if proc.returncode == 0 else 0, seconds=time.time() - started)
        if proc.returncode == 0 and dest.exists():
            _ROUTES[url] = (client, via_proxy)
            if via_proxy:
                log.info("fetched %s through the proxy after a refusal", url)
            return
        last = (proc.stderr or "").strip()
        log.warning("yt-dlp could not fetch %s as %s%s: %s", url, client,
                    " via proxy" if via_proxy else "", last[-300:])
        # Only a refusal is worth another address or another client, and so is
        # a client that doesn't offer the format asked for (the "tv" client has
        # no audio-only one, say). Anything else, such as a private video or a
        # dead link, fails the same way every time, and retrying it through
        # metered bandwidth buys nothing.
        if not (ytdlp_opts.looks_blocked(last) or _route_lacks_format(last) or ytdlp_opts.looks_transient(last)):
            break
    if ytdlp_opts.looks_transient(last):
        raise TransientFetch(_download_error(last))
    raise EngineError("VALIDATION_ERROR", _download_error(last))


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _route_lacks_format(stderr: str) -> bool:
    return "requested format is not available" in (stderr or "").lower()


def _ytdlp(url: str, dest: Path, on_progress=None) -> None:
    """Best quality up to YTDLP_MAX_HEIGHT (1080p unless set): clips are 1080x1920,
    and every byte of a refused download goes through the paid proxy."""
    run_ytdlp(url, dest, ["-f", link_format(), "--merge-output-format", "mp4"], on_progress=on_progress)


def download_whole(url: str, dest: Path, on_progress=None) -> None:
    """The whole linked video, for when sections can't be fetched on their own."""
    _ytdlp(url, dest, on_progress)


#: How long one section may take, and how many routes it tries, before the
#: job falls back to one whole download.
SECTION_TIMEOUT_S = 120
SECTION_ROUTES = 2


def fetch_section(url: str, dest: Path, start_ms: int, end_ms: int) -> None:
    """Only [start_ms, end_ms) of a link's video, at the same quality as a full import."""
    run_ytdlp(url, dest, ["-f", link_format(), "--merge-output-format", "mp4",
                          "--download-sections", f"*{start_ms / 1000:.3f}-{end_ms / 1000:.3f}"],
              # A section is seconds of video: one that takes minutes has
              # stalled, and the whole-download fallback is quicker than waiting.
              timeout=SECTION_TIMEOUT_S, max_routes=SECTION_ROUTES, kind="section")


def _lean_import(session: Session, asset: Asset, url: str) -> Asset | None:
    """A long link's audio and thumbnail only; the video comes per moment later.

    Returns None for a short video, which imports whole as before: its audio
    was a few megabytes, and one download is simpler than several.
    """
    from . import lean

    if not settings().lean_min_seconds:
        return None
    audio = storage.open_write(f"sources/{asset.id}/audio.m4a")
    if not audio.exists() or lean.audio_duration(audio) <= 0:
        run_ytdlp(url, audio, ["-f", lean.AUDIO_FORMAT, "--write-thumbnail", "--convert-thumbnails", "jpg"], kind="audio")
    duration = lean.audio_duration(audio)
    if not lean.is_long(duration):
        audio.unlink(missing_ok=True)
        return None
    cfg = settings()
    if duration > cfg.max_source_seconds:
        raise EngineError("VALIDATION_ERROR", f"That video is longer than the {cfg.max_source_seconds // 3600}h limit.")
    audio_key = f"sources/{asset.id}/audio.m4a"
    storage.put_file(audio, audio_key, "audio/mp4")
    thumb = next((p for p in sorted(audio.parent.glob("audio*.jpg"))), None)
    if thumb:
        thumb_key = f"thumbs/{asset.id}.jpg"
        dest = storage.open_write(thumb_key)
        if thumb.resolve() != dest.resolve():
            shutil.copy2(thumb, dest)
        storage.put_file(dest, thumb_key, "image/jpeg")
        asset.thumb_key = thumb_key
    asset.storage_key = audio_key
    asset.mezzanine_key = audio_key   # transcription and loudness read the audio
    asset.source_url = url
    asset.lean = True
    asset.length_s = round(duration, 3)
    asset.size_bytes = audio.stat().st_size
    asset.status = "ready"
    session.add(asset)
    session.commit()
    log.info("lean import of %s: %.0f min of audio, %d MB", url, duration / 60, asset.size_bytes // 1_000_000)
    webhooks.emit("asset.imported", asset_event(asset))
    return asset


def _download_error(stderr: str) -> str:
    """yt-dlp writes for maintainers. The person pasting a link needs one line."""
    from . import ytdlp_opts

    if ytdlp_opts.looks_blocked(stderr):
        return ("YouTube would not serve this video to the Engine — it asks a "
                "cloud server to prove it is not a bot. Download the video and "
                "upload the file instead, or set a residential proxy on the Engine.")
    low = stderr.lower()
    if "requested format is not available" in low or "no video formats" in low:
        return ("YouTube did not offer this server a usable video format. "
                "Download the video and upload it from the Library instead.")
    tail = stderr.strip().splitlines()[-2:]
    return "Could not fetch that link: " + " / ".join(tail)


def asset_event(asset: Asset) -> dict:
    """The webhook shape: the fields the app reads, plus the whole asset for anyone else."""
    full = asset_payload(asset)
    return {
        "asset_id": asset.id,
        "name": asset.name,
        "url": full["url"],
        "thumbnail_url": full["thumbnail_url"],
        "length_ms": round((asset.length_s or 0) * 1000),
        "size_bytes": asset.size_bytes,
        "quality_warning": asset.quality_warning,
        "asset": full,
    }


def asset_payload(asset: Asset) -> dict:
    return {
        "id": asset.id, "name": asset.name, "type": asset.type, "category": asset.category,
        "status": asset.status,
        "url": storage.public_url(asset.mezzanine_key or asset.storage_key) if (asset.mezzanine_key or asset.storage_key) else "",
        "thumbnail_url": storage.public_url(asset.thumb_key) if asset.thumb_key else "",
        "length": asset.length_s, "width": asset.width, "height": asset.height, "fps": asset.fps,
        "size": asset.size_bytes, "quality_warning": asset.quality_warning,
        "created_at": asset.created_at.isoformat(), "error": asset.error,
    }


def advance_one() -> bool:
    """Download one asset that is waiting to be imported. Returns True if it worked on something.

    The HTTP route only records the intent; the fetch happens here so no browser
    is left holding a connection open for a 30-minute video.
    """
    from sqlmodel import select

    from ..db import session

    with session() as s:
        asset = s.exec(
            select(Asset)
            .where(Asset.status == "importing")
            .where(Asset.source_url != "")
            .order_by(Asset.created_at)
        ).first()
        if not asset:
            return False
        url = asset.source_url
        asset.status = "downloading"
        s.add(asset)
        s.commit()
        try:
            _import_url(s, asset, url)
        except Exception as e:
            mark_failed(s, asset, e)
        return True
