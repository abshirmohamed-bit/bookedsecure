"""Several YouTube proxies, used healthiest first, switched automatically.

YTDLP_PROXY is the first proxy; YTDLP_PROXIES adds more (separated by commas,
spaces or new lines), e.g. the 2-5 addresses of an ISP plan, or a second
provider kept as a spare. Each download through a proxy is reported here:

  * a refusal (YouTube's bot check or a 403) adds to that proxy's streak;
    after BENCH_AFTER in a row it is benched for BENCH_MINUTES, doubling each
    time it is benched again (up to a day), so downloads move to the others;
  * a proxy whose plan is out of data (407 TRAFFIC_EXHAUSTED) is benched for
    EXHAUSTED_HOURS, and the others carry on;
  * a download that works clears the streak and updates its speed (an
    average over recent downloads), and faster proxies go first.

A benched proxy is still tried last when every other route has failed: a
bench is a preference, never a reason to refuse a download outright. The
state is kept in the data folder (proxy_state.json) so it survives the
machine sleeping, under a hash of each proxy, never its password.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta, timezone

log = logging.getLogger("engine.proxy_pool")

BENCH_AFTER = 3
BENCH_MINUTES = 30
BENCH_MAX_MINUTES = 24 * 60
EXHAUSTED_HOURS = 6
#: Weight of the newest download in the speed average.
SPEED_WEIGHT = 0.3
#: Downloads smaller than this say nothing about speed (lookups, thumbnails).
SPEED_MIN_BYTES = 5_000_000

_LOCK = threading.Lock()


def proxies() -> list[str]:
    """Every configured proxy, YTDLP_PROXY first, without repeats."""
    raw = [os.environ.get("YTDLP_PROXY") or ""] + re.split(r"[,\s]+", os.environ.get("YTDLP_PROXIES") or "")
    out: list[str] = []
    for p in (x.strip() for x in raw):
        if p and re.match(r"^(https?|socks5h?)://", p, re.I) and p not in out:
            out.append(p)
    return out


def key(proxy: str) -> str:
    return hashlib.sha256(proxy.encode()).hexdigest()[:12]


def label(proxy: str) -> str:
    """host:port, never the user name or password."""
    m = re.match(r"^[a-z0-9]+://(?:[^@/]*@)?([^/]+)", proxy, re.I)
    return m.group(1) if m else "proxy"


def _path():
    from ..config import settings

    return settings().data_dir / "proxy_state.json"


def _load() -> dict:
    try:
        return json.loads(_path().read_text())
    except (OSError, ValueError):
        return {}


def _save(state: dict) -> None:
    try:
        p = _path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(state))
        tmp.replace(p)
    except OSError as e:
        log.warning("couldn't save proxy state: %s", e)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _benched(entry: dict, now: datetime) -> bool:
    until = entry.get("benched_until")
    try:
        return bool(until) and datetime.fromisoformat(until) > now
    except ValueError:
        return False


def ordered(now: datetime | None = None) -> list[str]:
    """Proxies to try, best first: working ones by speed, then benched ones."""
    now = now or _now()
    with _LOCK:
        state = _load()
    pool = proxies()

    def rank(i_p):
        i, p = i_p
        e = state.get(key(p), {})
        return (_benched(e, now), e.get("streak", 0), -(e.get("speed") or 0.0), i)

    return [p for _, p in sorted(enumerate(pool), key=rank)]


def report(proxy: str, outcome: str, *, bytes_: int = 0, seconds: float = 0.0, now: datetime | None = None) -> None:
    """What one try through `proxy` came to: ok, blocked, exhausted, stalled or failed. Never raises."""
    if not proxy:
        return
    now = now or _now()
    try:
        with _LOCK:
            state = _load()
            e = state.setdefault(key(proxy), {})
            e["label"] = label(proxy)
            if outcome == "ok":
                e["streak"] = 0
                e["ok"] = e.get("ok", 0) + 1
                e["last_ok"] = now.isoformat()
                e.pop("benched_until", None)
                if bytes_ >= SPEED_MIN_BYTES and seconds > 0:
                    mb_s = bytes_ / seconds / 1_000_000
                    was = e.get("speed")
                    e["speed"] = round(mb_s if was is None else was + SPEED_WEIGHT * (mb_s - was), 3)
            elif outcome == "exhausted":
                e["blocked"] = e.get("blocked", 0) + 1
                e["benched_until"] = (now + timedelta(hours=EXHAUSTED_HOURS)).isoformat()
                e["reason"] = "out of data"
                log.error("proxy %s is out of data; benched for %dh", e["label"], EXHAUSTED_HOURS)
            elif outcome == "blocked":
                e["blocked"] = e.get("blocked", 0) + 1
                e["streak"] = e.get("streak", 0) + 1
                if e["streak"] >= BENCH_AFTER:
                    minutes = min(BENCH_MAX_MINUTES, BENCH_MINUTES * (2 ** e.get("benches", 0)))
                    e["benches"] = e.get("benches", 0) + 1
                    e["benched_until"] = (now + timedelta(minutes=minutes)).isoformat()
                    e["reason"] = "refused by YouTube"
                    e["streak"] = 0
                    log.warning("proxy %s refused %d times in a row; benched for %d min", e["label"], BENCH_AFTER, minutes)
            if outcome == "ok" and e.get("benches"):
                # Working again: the next bench starts short.
                e["benches"] = max(0, e["benches"] - 1)
            _save(state)
    except Exception as ex:  # noqa: BLE001 - statistics never stop a download
        log.warning("couldn't record a proxy result: %s", ex)


def status(now: datetime | None = None) -> list[dict]:
    """Each proxy's health, for GET /v1/proxy/health (labels only, no passwords)."""
    now = now or _now()
    with _LOCK:
        state = _load()
    out = []
    for p in ordered(now):
        e = state.get(key(p), {})
        benched = _benched(e, now)
        out.append({
            "label": label(p), "state": "benched" if benched else "ok",
            "benched_until": e.get("benched_until") if benched else None,
            "reason": e.get("reason") if benched else None,
            "speed_mb_s": e.get("speed"), "ok": e.get("ok", 0), "refused": e.get("blocked", 0),
            "last_ok": e.get("last_ok"),
        })
    return out
