"""How many exports may render at once: as many as the machine has memory for.

A 1080 x 1920 render of a busy clip can take over 1 GB (a 25-shot clip once
passed 2.8 GB before card sources were split). Two at once beside the face
analysis ran Fly's 4 GB machine out of memory, and the kernel's OOM killer
takes the whole Engine down with it, so the old rule was one at a time.

The gate keeps that on a 4 GB machine and opens up on a bigger one:

  * capacity: (total memory - RENDER_BASE_MB for the Engine and analysis)
    / RENDER_MEMORY_MB, at least 1 and at most CONCURRENT_RENDERS;
  * a further render starts only while the memory free right now leaves
    room for it plus headroom, so a heavy analysis or download still wins;
  * a 4K render weighs as two.

The first render always starts, so a slow reading never stalls the queue.
Off Linux (no /proc/meminfo) it is one at a time, as before.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from ..config import settings

log = logging.getLogger("engine.render_gate")

#: Kept free beyond a new render's own share, for whatever else starts meanwhile.
HEADROOM_MB = 500
WAIT_S = 5.0


def _meminfo() -> "dict[str, int] | None":
    """/proc/meminfo in MB, or None where there is no such file."""
    try:
        text = Path("/proc/meminfo").read_text()
    except OSError:
        return None
    out: dict[str, int] = {}
    for line in text.splitlines():
        name, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            out[name.strip()] = int(parts[0]) // 1024
    return out


def capacity(total_mb: "int | None" = None) -> int:
    """Renders this machine may run at once, in 1080p units."""
    cfg = settings()
    if total_mb is None:
        info = _meminfo()
        total_mb = info.get("MemTotal") if info else None
    if not total_mb:
        return 1
    fits = (total_mb - cfg.render_base_mb) // max(1, cfg.render_memory_mb)
    return int(max(1, min(max(1, cfg.concurrent_renders), fits)))


def weight(resolution: str) -> int:
    return 2 if resolution == "2160p" else 1


def room_for(w: int, used: int, cap: int, available_mb: "int | None") -> bool:
    """Whether a render of weight `w` may start now."""
    if used == 0:
        return True                       # the queue always moves
    if used + w > cap or available_mb is None:
        return False
    return available_mb >= w * settings().render_memory_mb + HEADROOM_MB


class Gate:
    def __init__(self) -> None:
        self._cv = threading.Condition()
        self._used = 0

    @property
    def running(self) -> int:
        return self._used

    def acquire(self, w: int = 1) -> None:
        cap = capacity()
        with self._cv:
            while True:
                info = _meminfo()
                free = info.get("MemAvailable") if info else None
                if room_for(w, self._used, cap, free):
                    self._used += w
                    if self._used > 1:
                        log.info("render gate: %d units rendering (capacity %d, %s MB free)", self._used, cap, free)
                    return
                self._cv.wait(WAIT_S)

    def release(self, w: int = 1) -> None:
        with self._cv:
            self._used = max(0, self._used - w)
            self._cv.notify_all()


GATE = Gate()
