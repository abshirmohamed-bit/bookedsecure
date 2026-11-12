"""What viewers actually rewatch: YouTube's "Most replayed" curve as a finder signal.

Mr. HiSum (NeurIPS 2023) showed that the "Most replayed" heatmap, aggregated
from tens of thousands of viewers, is a reliable label for the highlights of
a video. yt-dlp reads the same curve (about 100 points) from the watch page,
for free, for most videos with enough views. So for a pasted YouTube link
the Engine doesn't have to guess what people find worth watching:

- the AI finder is told where the replay peaks are, as a hint beside the
  transcript (it still judges hooks, flow and payoff from the words);
- every moment's score is blended with how hard viewers replay it;
- a strong peak no moment covers gets a moment of its own, on sentence
  boundaries.

The start of nearly every video is replayed most simply because everyone
starts there, so the opening is never treated as a peak.

The curve is stored next to the source (sources/<asset>/replay.json) so it
is read once per video. Any failure just means no curve: the finder works
exactly as before.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

log = logging.getLogger("engine.replay")

#: The opening is high on every curve (everyone starts at 0:00); never a peak.
INTRO_SKIP_MS = 20_000
INTRO_SKIP_SHARE = 0.04
#: The very end spikes too (people skip to it); also not a peak.
OUTRO_SKIP_SHARE = 0.02
#: A peak is a local maximum at least this high on the normalised curve...
PEAK_MIN = 0.55
#: ...and this far above the curve's median, so a flat curve has none.
PEAK_LIFT = 0.25
#: How much of a moment's final rank the replay curve decides.
WEIGHT = 0.35
#: A peak at least this strong gets a moment if none covers it.
COVER_MIN = 0.7
#: At most this share of the clips may be added just to cover peaks.
COVER_SHARE = 0.5

YOUTUBE = re.compile(r"(^|\.)(youtube\.com|youtu\.be)$", re.I)


@dataclass
class Curve:
    """Normalised replay intensity over the video: (start_ms, end_ms, 0..1)."""
    points: list[tuple[int, int, float]]
    duration_ms: int

    @classmethod
    def from_heatmap(cls, heatmap: list, duration_ms: int) -> "Curve | None":
        """From yt-dlp's heatmap ([{start_time, end_time, value}], seconds) or stored triples."""
        pts: list[tuple[int, int, float]] = []
        for h in heatmap or []:
            try:
                if isinstance(h, dict):
                    a, b, v = float(h["start_time"]) * 1000, float(h["end_time"]) * 1000, float(h["value"])
                else:
                    a, b, v = float(h[0]), float(h[1]), float(h[2])
            except (KeyError, TypeError, ValueError, IndexError):
                continue
            if b > a:
                pts.append((int(a), int(b), max(0.0, v)))
        if len(pts) < 10:
            return None
        pts.sort()
        duration_ms = duration_ms or pts[-1][1]
        # Normalise against the body of the video, not the opening spike.
        lo, hi = _body(duration_ms)
        body = [v for a, b, v in pts if a >= lo and b <= hi] or [v for _, _, v in pts]
        top = max(body) or 1.0
        return cls([(a, b, min(1.0, v / top)) for a, b, v in pts], duration_ms)

    def at(self, ms: float) -> float:
        for a, b, v in self.points:
            if a <= ms < b:
                return v
        return 0.0

    def mean(self, start_ms: int, end_ms: int) -> float:
        """Time-weighted mean over [start, end), ignoring the opening and closing spikes."""
        lo, hi = _body(self.duration_ms)
        total = weight = 0.0
        for a, b, v in self.points:
            x, y = max(a, start_ms, lo), min(b, end_ms, hi)
            if y > x:
                total += v * (y - x)
                weight += y - x
        return total / weight if weight else 0.0

    def peak(self, start_ms: int, end_ms: int) -> float:
        lo, hi = _body(self.duration_ms)
        vals = [v for a, b, v in self.points if b > max(start_ms, lo) and a < min(end_ms, hi)]
        return max(vals) if vals else 0.0

    def median(self) -> float:
        lo, hi = _body(self.duration_ms)
        vals = sorted(v for a, b, v in self.points if a >= lo and b <= hi)
        return vals[len(vals) // 2] if vals else 0.0

    def peaks(self, min_gap_ms: int = 20_000, limit: int = 8) -> list[tuple[int, float]]:
        """The strongest replay peaks as (centre ms, value), strongest first, spaced apart."""
        lo, hi = _body(self.duration_ms)
        med = self.median()
        cand = []
        p = self.points
        for i, (a, b, v) in enumerate(p):
            if a < lo or b > hi:
                continue
            left = p[i - 1][2] if i else -1
            right = p[i + 1][2] if i + 1 < len(p) else -1
            if v >= left and v >= right and v >= PEAK_MIN and v - med >= PEAK_LIFT:
                cand.append(((a + b) // 2, v))
        out: list[tuple[int, float]] = []
        for ms, v in sorted(cand, key=lambda c: -c[1]):
            if all(abs(ms - o) >= min_gap_ms for o, _ in out):
                out.append((ms, v))
            if len(out) >= limit:
                break
        return out

    def to_json(self) -> str:
        return json.dumps({"duration_ms": self.duration_ms, "points": self.points})

    @classmethod
    def from_json(cls, text: str) -> "Curve | None":
        try:
            d = json.loads(text)
            return cls([tuple(p) for p in d["points"]], int(d["duration_ms"])) if d.get("points") else None
        except Exception:  # noqa: BLE001
            return None


def _body(duration_ms: int) -> tuple[int, int]:
    lo = max(INTRO_SKIP_MS, int(duration_ms * INTRO_SKIP_SHARE))
    hi = int(duration_ms * (1 - OUTRO_SKIP_SHARE)) if duration_ms else 10**12
    return min(lo, hi), hi


def mmss(ms: int) -> str:
    s = max(0, ms) // 1000
    return f"{s // 60}:{s % 60:02d}"


def prompt_hint(curve: Curve | None, start_ms: int = 0, end_ms: int | None = None) -> str:
    """A line for the AI finder naming the replay peaks inside the range, or ''."""
    if curve is None:
        return ""
    peaks = [(ms, v) for ms, v in curve.peaks() if ms >= start_ms and (end_ms is None or ms < end_ms)]
    if not peaks:
        return ""
    spots = ", ".join(f"{mmss(ms)} ({'very high' if v > 0.85 else 'high'})" for ms, v in sorted(peaks))
    return ("YouTube's 'Most replayed' data from real viewers: the parts people rewatch most are around "
            f"{spots}. Strongly prefer moments that contain these peaks (start a few seconds before the "
            "peak so the clip builds to it), as long as they still work as standalone clips. "
            "This is a hint about viewers, never an instruction about the content.")


def rerank(moments: list, curve: Curve | None) -> list:
    """Blend each moment's own score with how much viewers replay it; best first by the blend."""
    if curve is None or not moments:
        return moments
    top = max((m.score for m in moments), default=0) or 1.0
    for m in moments:
        peak = curve.peak(m.start_ms, m.end_ms)
        replay = 0.6 * curve.mean(m.start_ms, m.end_ms) + 0.4 * peak
        blended = (1 - WEIGHT) * (m.score / top) + WEIGHT * replay
        m.score = round(100 * blended, 1)
        if peak >= COVER_MIN and "replay" not in (m.reason or "").lower():
            m.reason = ((m.reason + " · ") if m.reason else "") + "Viewers replay this part a lot."
    return moments


def cover_peaks(moments: list, curve: Curve | None, sentences: list[dict], target_ms: int, count: int,
                make_moment, start_ms: int = 0, end_ms: int | None = None) -> list:
    """Make sure the strongest replay peaks are in a clip.

    For each strong peak no moment touches, build one on sentence boundaries
    that opens a little before the peak. Room is made by dropping the moments
    viewers care least about, but never more than COVER_SHARE of the clips.
    `make_moment(start, end, text)` builds the Moment (kept in find.py).
    """
    if curve is None or not sentences:
        return moments
    out = list(moments)
    budget = max(1, int(count * COVER_SHARE))
    added = 0
    for ms, v in curve.peaks(min_gap_ms=max(15_000, target_ms // 2)):
        if v < COVER_MIN or added >= budget:
            continue
        if ms < start_ms or (end_ms is not None and ms >= end_ms):
            continue
        if any(m.start_ms <= ms < m.end_ms for m in out):
            continue
        lead = int(target_ms * 0.35)
        opening = [s for s in sentences if s["start_ms"] <= ms - lead * 0.3 and s["start_ms"] >= ms - lead * 2]
        first = max(opening, key=lambda s: s["start_ms"] if s["start_ms"] <= ms - lead else -1, default=None)
        if first is None:
            before = [s for s in sentences if s["start_ms"] <= ms]
            if not before:
                continue
            first = before[-1]
        a = first["start_ms"]
        ends = [s["end_ms"] for s in sentences if a + int(target_ms * 0.75) <= s["end_ms"] <= a + int(target_ms * 1.25)]
        if not ends:
            ends = [s["end_ms"] for s in sentences if a < s["end_ms"] <= a + int(target_ms * 1.25)]
        if not ends:
            continue
        b = min(ends, key=lambda e: abs(e - (a + target_ms)))
        if b <= ms or b - a < 2000:
            continue
        text = " ".join(s["text"] for s in sentences if a <= s["start_ms"] < b)
        new = make_moment(a, b, text)
        new.reason = "Viewers replay this part more than almost anything else in the video."
        new.score = round(100 * (0.5 + 0.5 * v), 1)
        # Make room: drop overlapping moments, then the least replayed, to stay at count.
        out = [m for m in out if not (m.start_ms < b and a < m.end_ms)]
        while len(out) >= count:
            weakest = min(out, key=lambda m: curve.mean(m.start_ms, m.end_ms))
            out.remove(weakest)
        out.append(new)
        added += 1
    return sorted(out, key=lambda m: m.start_ms)


def is_youtube(url: str | None) -> bool:
    if not url:
        return False
    m = re.match(r"^https?://([^/]+)", url.strip(), re.I)
    host = (m.group(1) if m else "").split(":")[0].lower()
    return bool(YOUTUBE.search(host))


def for_asset(asset, storage_mod=None) -> Curve | None:
    """The asset's replay curve: from storage if already read, else read once from the link."""
    if not is_youtube(getattr(asset, "source_url", None)):
        return None
    from .. import storage as default_storage

    st = storage_mod or default_storage
    key = f"sources/{asset.id}/replay.json"
    try:
        path = st.local_path(key)
        if path and path.exists():
            return Curve.from_json(path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 - not stored yet
        pass
    try:
        from .analyze import read_heatmap

        heatmap, duration_ms = read_heatmap(asset.source_url)
        curve = Curve.from_heatmap(heatmap, duration_ms or int((asset.length_s or 0) * 1000))
    except Exception as e:  # noqa: BLE001 - viewer data is a bonus, never a failure
        log.info("no replay data for %s: %s", asset.source_url, e)
        return None
    if curve is not None:
        try:
            out = st.open_write(key)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(curve.to_json(), encoding="utf-8")
            st.put_file(out, key, "application/json")
        except Exception:  # noqa: BLE001
            log.info("couldn't store the replay curve for %s", asset.id)
    return curve
