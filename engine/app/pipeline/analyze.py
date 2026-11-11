"""Look at a link before committing to it.

The dashboard pastes a URL and needs to show the creator what they are about
to work with — title, length, thumbnail, the best resolution on offer, whether
captions already exist — and sensible defaults for the options panel. None of
that should cost a download, so this only ever reads metadata.
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from ..config import settings
from ..errors import EngineError
from .find import suggest_count

log = logging.getLogger("engine.analyze")

# Sites whose terms mean the creator must confirm they hold the rights.
log = logging.getLogger("engine.analyze")

RIGHTS_HOSTS = re.compile(
    r"(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|twitch\.tv|x\.com|twitter\.com)",
    re.I,
)


def quality_label(height: int) -> str:
    """What the badge over the thumbnail says."""
    if height >= 2160:
        return "4K"
    if height >= 1440:
        return "1440p"
    if height >= 1080:
        return "1080p"
    if height >= 720:
        return "720p"
    return f"{height}p" if height else "unknown"


@dataclass
class Chapter:
    title: str
    start_ms: int
    end_ms: int


@dataclass
class UrlInfo:
    url: str
    title: str = ""
    channel: str = ""
    duration_ms: int = 0
    thumbnail_url: str = ""
    best_height: int = 0
    best_width: int = 0
    fps: float = 0.0
    quality: str = "unknown"
    resolutions: list[int] = field(default_factory=list)
    subtitle_languages: list[str] = field(default_factory=list)
    language: str = ""
    chapters: list[Chapter] = field(default_factory=list)
    is_live: bool = False
    needs_rights: bool = False
    extractor: str = ""
    quality_warning: bool = False

    def payload(self) -> dict[str, Any]:
        d = asdict(self)
        d["duration_s"] = round(self.duration_ms / 1000, 2)
        d["suggested"] = self.suggestions()
        return d

    def suggestions(self) -> dict[str, Any]:
        """What the options panel should arrive pre-filled with."""
        secs = self.duration_ms / 1000
        if secs <= 0:
            band = "auto"
        elif secs < 10 * 60:
            band = "30s~59s"
        elif secs < 45 * 60:
            band = "60s~89s"
        else:
            band = "90s~3m"
        return {
            "clip_count": suggest_count(self.duration_ms, "best_moments", 60),
            "clip_length": band,
            # the creator already has captions, so offer to use them
            "use_existing_subtitles": bool(self.subtitle_languages),
            "language": self.language or "auto",
            "rights_confirmation_required": self.needs_rights,
        }


def analyze(url: str) -> UrlInfo:
    """Metadata only — nothing is downloaded and nothing is stored."""
    url = (url or "").strip()
    if not re.match(r"^https?://", url, re.I):
        raise EngineError("VALIDATION_ERROR", "That does not look like a link. Paste a full URL.")
    provider = settings().analyze_provider
    info = _fake(url) if provider == "fake" else _ytdlp(url)
    cfg = settings()
    if info.duration_ms and info.duration_ms > cfg.max_source_seconds * 1000:
        hours = cfg.max_source_seconds // 3600
        raise EngineError("VALIDATION_ERROR", f"That video is longer than the {hours}h limit.")
    if info.is_live:
        raise EngineError("VALIDATION_ERROR", "That is a live stream. Wait until it has finished.")
    return info


def _common(url: str, info: UrlInfo) -> UrlInfo:
    info.needs_rights = bool(RIGHTS_HOSTS.search(url))
    info.quality = quality_label(info.best_height)
    info.quality_warning = 0 < info.best_height < 1080
    return info


def _ytdlp(url: str) -> UrlInfo:
    try:
        import yt_dlp
    except ImportError as e:  # pragma: no cover - production dependency
        raise EngineError("ENGINE_ERROR", "The link importer is not installed on this Engine.") from e

    from . import ytdlp_opts

    # YouTube gates each player client differently, so a refusal for one is
    # worth retrying as another before telling the user it cannot be read.
    raw = None
    last = ""
    for client, via_proxy in ytdlp_opts.attempts():
        # format=None keeps yt-dlp from doing format selection at all on a
        # metadata read, which is where a thin server-side list bites.
        opts = {**ytdlp_opts.api_opts(client, via_proxy),
                "skip_download": True, "format": None}
        try:
            with yt_dlp.YoutubeDL(opts) as y:
                raw = y.extract_info(url, download=False)
            break
        except Exception as e:
            last = str(e)
            if not ytdlp_opts.looks_blocked(last):
                raise EngineError("IMPORT_FAILED", _friendly(last)) from e
            log.warning("yt-dlp was refused for %s as %s%s: %s", url, client,
                        " via proxy" if via_proxy else "", last)
    if raw is None:
        raise EngineError("IMPORT_FAILED", _friendly(last))
    if not raw:
        raise EngineError("IMPORT_FAILED", "Nothing could be read from that link.")
    if raw.get("_type") == "playlist":
        entries = [x for x in (raw.get("entries") or []) if x]
        if not entries:
            raise EngineError("VALIDATION_ERROR", "That playlist is empty.")
        raw = entries[0]

    heights = sorted({int(f["height"]) for f in (raw.get("formats") or [])
                      if f.get("height") and f.get("vcodec") not in (None, "none")})
    best_h = int(raw.get("height") or (heights[-1] if heights else 0))
    best_w = int(raw.get("width") or 0)
    chapters = [Chapter(str(c.get("title") or f"Chapter {i + 1}"),
                        int(float(c.get("start_time") or 0) * 1000),
                        int(float(c.get("end_time") or 0) * 1000))
                for i, c in enumerate(raw.get("chapters") or [])]
    subs = sorted(set(raw.get("subtitles") or {}) | set(raw.get("automatic_captions") or {}))

    return _common(url, UrlInfo(
        url=url,
        title=str(raw.get("title") or "")[:300],
        channel=str(raw.get("channel") or raw.get("uploader") or "")[:160],
        duration_ms=int(float(raw.get("duration") or 0) * 1000),
        thumbnail_url=str(raw.get("thumbnail") or ""),
        best_height=best_h, best_width=best_w,
        fps=float(raw.get("fps") or 0),
        resolutions=heights,
        subtitle_languages=subs[:40],
        language=str(raw.get("language") or ""),
        chapters=chapters,
        is_live=bool(raw.get("is_live")),
        extractor=str(raw.get("extractor_key") or ""),
    ))


def _friendly(message: str) -> str:
    """yt-dlp's errors are for maintainers; creators need the one-line version."""
    m = message.lower()
    if "private" in m:
        return "That video is private."
    if "members-only" in m or "join this channel" in m:
        return "That video is for channel members only."
    if "age" in m and ("confirm" in m or "restricted" in m):
        return "That video is age-restricted, so the Engine cannot read it."
    if "unavailable" in m or "removed" in m or "deleted" in m:
        return "That video is unavailable or has been removed."
    if "not available in your country" in m or "geo" in m:
        return "That video is blocked in the region the Engine runs in."
    if "sign in" in m or "cookies" in m or "bot" in m or "captcha" in m:
        return ("YouTube is asking the Engine to prove it is not a bot, which it "
                "cannot do. Download the video and upload it from the Library.")
    if "429" in m or "too many requests" in m or "rate" in m and "limit" in m:
        return "YouTube is rate-limiting the Engine. Wait a few minutes and try again."
    if "requested format is not available" in m or "no video formats" in m:
        return ("YouTube did not offer this server a usable video format — it often "
                "limits what datacenter servers can fetch. Download the video and "
                "upload it from the Library.")
    if "unsupported url" in m or "no suitable" in m:
        return "That link is not from a site the Engine can read."
    if "proxy" in m or "timed out" in m or "connection" in m or "unable to download" in m:
        return "The Engine could not reach that site."
    if "live" in m and "not started" in m:
        return "That is a scheduled stream that has not started."
    # Nothing matched: say so honestly and point at where the detail lives.
    return ("That link could not be read. The exact reason is in the Engine log "
            "(fly logs -a crayzmundo-engine).")


def _fake(url: str) -> UrlInfo:
    """Deterministic stand-in so the flow is testable without network access."""
    seed = sum(url.encode()) % 7
    minutes = 12 + seed * 9
    return _common(url, UrlInfo(
        url=url,
        title=f"Sample video {seed}",
        channel="Sample channel",
        duration_ms=minutes * 60_000,
        thumbnail_url="https://example.invalid/thumb.jpg",
        best_height=[2160, 1080, 720][seed % 3],
        best_width=[3840, 1920, 1280][seed % 3],
        fps=30.0,
        resolutions=[360, 720, 1080],
        subtitle_languages=["en"] if seed % 2 else [],
        language="en",
        extractor="Fake",
    ))
