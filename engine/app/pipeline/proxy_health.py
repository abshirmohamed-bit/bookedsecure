"""How well YouTube downloads are going through the residential proxy.

Every yt-dlp try is recorded (outcome, direct or proxy, the proxy's mode,
bytes, seconds), and summary() turns the last week of them, plus the link
imports and clip jobs that failed on YouTube's bot check, into the numbers
BookedSecure uses to say when it's time for a faster, more trusted (ISP)
proxy plan. Nothing here changes the proxy: that is the owner's decision.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from sqlmodel import select

from ..db import session
from ..models import Asset, Job, ProxyDownload

log = logging.getLogger("engine.proxy_health")

#: Downloads smaller than this are lookups and thumbnails; they say nothing about speed.
SPEED_MIN_BYTES = 5_000_000
BOT_CHECK = re.compile(r"not a bot|sign in to confirm|http error 403|403 forbidden|forbidden|would not serve", re.I)


def mode_of(proxy_url: str) -> str:
    """sticky, rotating or other, from the proxy's port (DataImpulse: 10000-20000 sticky, 823 rotating)."""
    if not proxy_url:
        return "none"
    m = re.search(r":(\d+)/?$", proxy_url.strip())
    port = int(m.group(1)) if m else 0
    if 10000 <= port <= 20000:
        return "sticky"
    if port == 823:
        return "rotating"
    return "other"


def outcome_of(returncode: int | None, stderr: str, stalled: bool = False) -> str:
    if stalled:
        return "stalled"
    if returncode == 0:
        return "ok"
    return "blocked" if BOT_CHECK.search(stderr or "") else "failed"


def record(*, kind: str, via_proxy: bool, mode: str, outcome: str, bytes_: int, seconds: float) -> None:
    """One yt-dlp try. Never raises: the download matters more than its statistics."""
    try:
        with session() as s:
            s.add(ProxyDownload(kind=kind, via_proxy=via_proxy, mode=mode if via_proxy else "direct",
                                outcome=outcome, bytes=max(0, int(bytes_)), seconds=round(max(0.0, seconds), 2)))
            s.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("couldn't record a download: %s", e)


def summary(days: int = 7, now: datetime | None = None) -> dict:
    """The last `days` of proxy use, in the shape GET /v1/proxy/health returns."""
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    with session() as s:
        rows = s.exec(select(ProxyDownload).where(ProxyDownload.created_at >= since)).all()
        failed_assets = s.exec(select(Asset).where(Asset.status == "failed", Asset.created_at >= since)).all()
        failed_jobs = s.exec(select(Job).where(Job.status == "failed", Job.created_at >= since)).all()
        long_links = s.exec(select(Asset).where(Asset.lean == True, Asset.parent_id == "",  # noqa: E712
                                                Asset.created_at >= since)).all()
    proxied = [r for r in rows if r.via_proxy]
    timed = [r for r in proxied if r.outcome == "ok" and r.bytes >= SPEED_MIN_BYTES and r.seconds > 0]
    speed = (sum(r.bytes for r in timed) / sum(r.seconds for r in timed) / 1_000_000) if timed else None
    bot_failures = sum(1 for a in failed_assets if BOT_CHECK.search(a.error or "")) \
        + sum(1 for j in failed_jobs if BOT_CHECK.search(j.error or ""))
    from .ytdlp_opts import proxy
    return {
        "days": days,
        "proxy_mode": mode_of(proxy()),
        "bot_check_failures": bot_failures,
        "proxy_speed_mb_s": round(speed, 3) if speed is not None else None,
        "speed_samples": len(timed),
        "long_links_clipped": len(long_links),
        "proxy_tries": len(proxied),
        "proxy_refusals": sum(1 for r in proxied if r.outcome == "blocked"),
        "proxy_bytes": sum(r.bytes for r in proxied),
    }
