"""Bearer auth plus a small token-bucket rate limit, per key and per tier."""
from __future__ import annotations

import time
from collections import defaultdict

from fastapi import Request

from .config import settings
from .errors import EngineError

# requests, per seconds
TIERS = {
    "default": (50, 60),
    "heavy": (10, 60),    # autoclip, export, renders, transcripts
    "poll": (120, 60),    # GETs the app polls
    "upload": (20, 60),
}
_buckets: dict[tuple[str, str], list[float]] = defaultdict(list)


def tier_for(path: str, method: str) -> str:
    if path.startswith("/v1/uploads"):
        return "upload"
    heavy = ("/v1/autoclip", "/v1/transcripts", "/v1/renders", "/export")
    if method == "POST" and any(h in path for h in heavy):
        return "heavy"
    if method == "GET":
        return "poll"
    return "default"


def check_key(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise EngineError("UNAUTHORIZED", "Send an Authorization: Bearer <key> header.")
    key = header[7:].strip()
    if key not in settings().keys:
        raise EngineError("UNAUTHORIZED", "That API key is not valid for this Engine.")
    return key


def check_rate(key: str, tier: str, now: float | None = None) -> tuple[int, int, int]:
    """Returns (limit, remaining, reset_seconds); raises when the bucket is empty."""
    limit, window = TIERS[tier]
    now = now or time.time()
    hits = _buckets[(key, tier)]
    cutoff = now - window
    hits[:] = [h for h in hits if h > cutoff]
    if len(hits) >= limit:
        retry = int(hits[0] + window - now) + 1
        raise EngineError("RATE_LIMITED", f"Too many requests. Try again in {retry}s.", retry_after=retry)
    hits.append(now)
    reset = int(hits[0] + window - now) if hits else window
    return limit, limit - len(hits), reset


def reset_buckets() -> None:
    _buckets.clear()
