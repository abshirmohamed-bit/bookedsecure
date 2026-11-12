"""Lean imports: long links without downloading the whole video.

A 90-minute video is about 1.2 GB at 1080p, and through a residential proxy
that is most of the time a job takes. Only the moments that become clips need
video, so a long link imports its audio first (about a tenth of the size),
is transcribed and searched like any other source, and then fetches only the
video around each chosen moment: a "section" asset per clip.

A section cut from a stream starts on the nearest keyframe, a few seconds
either side of where it was asked to. Its real position is found by matching
its audio against the full audio, so captions and trims stay exact.
"""
from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .. import media
from ..config import settings

log = logging.getLogger("engine.lean")

#: The audio the finder works from: AAC in m4a, else the best audio offered.
AUDIO_FORMAT = "ba[ext=m4a]/ba"
#: Matching runs at 8 kHz: plenty to place speech to the millisecond.
MATCH_RATE = 8000
PROBE_S = 10.0           # how much of the section is matched
SEARCH_S = 20.0          # how far either side of the asked-for start to look
MIN_SCORE = 0.5          # below this the match is a guess; keep the asked-for start


def is_long(duration_s: float) -> bool:
    cfg = settings()
    return bool(cfg.lean_min_seconds) and duration_s >= cfg.lean_min_seconds


@dataclass(frozen=True)
class Section:
    index: int
    start_ms: int
    end_ms: int


def plan_sections(moments: list[tuple[int, int]], length_ms: int, pad_ms: int | None = None) -> list[Section]:
    """The video to fetch for each moment, with room either side for a trim."""
    pad = settings().section_pad_ms if pad_ms is None else pad_ms
    out = []
    for i, (start, end) in enumerate(moments):
        a = max(0, start - pad)
        b = min(length_ms, end + pad) if length_ms > 0 else end + pad
        out.append(Section(i, a, max(b, a + 1000)))
    return out


def audio_duration(path: Path) -> float:
    out = media.run([media._bin("ffprobe"), "-v", "quiet", "-show_entries", "format=duration",
                     "-of", "default=nw=1:nk=1", str(path)], timeout=120).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def _pcm(src: Path, start_s: float, length_s: float) -> "np.ndarray":
    """Mono 8 kHz samples from `start_s`, aligned to the file's own timeline."""
    import numpy as np

    cmd = [media._bin("ffmpeg"), "-v", "quiet", "-ss", f"{max(0.0, start_s):.3f}", "-t", f"{length_s:.3f}",
           "-i", str(src), "-vn", "-ac", "1", "-ar", str(MATCH_RATE),
           # pad to the file's start so a late first audio packet doesn't shift everything
           "-af", "aresample=async=1:first_pts=0", "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=300)
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32)


def best_lag(window: "np.ndarray", probe: "np.ndarray") -> tuple[int, float]:
    """Where `probe` sits inside `window`, in samples, and how sure (0..1).

    Normalised cross-correlation through the FFT: the score is the cosine
    similarity of the probe and the window at that lag, so silence or a
    different recording scores low instead of matching anywhere.
    """
    import numpy as np

    n, m = len(window), len(probe)
    if m == 0 or n < m:
        return 0, 0.0
    probe = probe - probe.mean()
    size = 1 << (n + m - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(window, size) * np.conj(np.fft.rfft(probe, size)), size)[: n - m + 1]
    csum = np.concatenate(([0.0], np.cumsum(window.astype(np.float64))))
    csq = np.concatenate(([0.0], np.cumsum(window.astype(np.float64) ** 2)))
    sums = csum[m:] - csum[:-m]
    energy = np.maximum(csq[m:] - csq[:-m] - sums * sums / m, 1e-9)
    score = corr / (np.sqrt(energy) * max(float(np.linalg.norm(probe)), 1e-9))
    lag = int(np.argmax(score))
    return lag, float(score[lag])


def measure_offset(full_audio: Path, section: Path, asked_ms: int) -> int:
    """Where `section` really starts in the source, in ms."""
    try:
        probe = _pcm(section, 0.0, PROBE_S)
        window_start_s = max(0.0, asked_ms / 1000 - SEARCH_S)
        window = _pcm(full_audio, window_start_s, 2 * SEARCH_S + PROBE_S)
        lag, score = best_lag(window, probe)
    except Exception as e:  # noqa: BLE001 - a failed match falls back, it never fails the job
        log.warning("could not match %s against its source: %s", section.name, e)
        return asked_ms
    if score < MIN_SCORE:
        log.info("weak match for %s (%.2f); keeping the asked-for start", section.name, score)
        return asked_ms
    found = round(window_start_s * 1000 + lag * 1000 / MATCH_RATE)
    log.info("%s starts at %dms (asked %dms, match %.2f)", section.name, found, asked_ms, score)
    return found


def rebase(items: list[dict], offset_ms: int, start_ms: int, end_ms: int) -> list[dict]:
    """Words or sentences inside [start_ms, end_ms), moved so the section starts at 0."""
    out = []
    for it in items:
        if it["end_ms"] <= start_ms or it["start_ms"] >= end_ms:
            continue
        moved = {**it, "start_ms": it["start_ms"] - offset_ms, "end_ms": it["end_ms"] - offset_ms}
        if isinstance(it.get("words"), list):
            moved["words"] = rebase(it["words"], offset_ms, start_ms, end_ms)
        out.append(moved)
    return out
