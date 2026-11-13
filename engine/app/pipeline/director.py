"""The virtual camera operator: where a tall window sits in a wide shot.

An editor reframing a 16:9 interview for 9:16 does not drag one crop
smoothly across the whole clip. They work shot by shot, because every camera
cut puts people somewhere new:

- At a cut the frame is re-aimed on that exact frame. A position carried
  over from the last shot is aimed at wherever someone used to be, which is
  how a clip ends up framed on the flag behind two people.
- If everyone in the shot fits in the window, frame them all.
- If they do not, frame whoever is talking, and change to the other person
  only at a turn that lasts. When nobody can be named, take the most
  prominent face: the largest, most often seen.
- Hold still. A locked-off camera that keeps the face comfortably inside
  beats one that follows every twitch. Follow only when the person actually
  moves further than the window allows, and never let them leave it.
- Never leave half a face at the edge of the frame: move off it, or take it
  in whole.

Everything here is plain arithmetic over what speaker.face_tracks found, so
the decisions are cheap and can be tested without a video.
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median

#: A subject change shorter than this is an interjection, not a turn worth
#: cutting to: cutting for a "yeah" and back again reads as a twitch.
MIN_HOLD_MS = 1500
#: How much of the window, each side, the subject's face keeps clear of the
#: edge. A face touching the frame edge looks like a mistake even when whole.
EDGE_MARGIN = 0.12
#: The same idea for someone else's face we are steering off: the gap
#: between the window edge and their face.
OTHER_MARGIN = 0.01
#: A person's shoulders are about this many face widths across.
BODY_WIDTH = 2.8
#: Output spacing while following a subject who moves.
FOLLOW_STEP_MS = 100
#: Easing while following: the share of the remaining distance covered per
#: step. Slow enough to read as a camera, fast enough that the face stays in.
FOLLOW_EASE = 0.25
#: A face seen in fewer than this share of a shot's detections is a passer-by,
#: a poster or a false positive, unless it is the only face there is.
MIN_PRESENCE = 0.25
#: Sample a shot start this much before the cut: the pan command then lands on
#: the cut frame itself rather than one frame after it.
CUT_LEAD_MS = 10


@dataclass
class Person:
    """One face within one shot."""
    id: int
    boxes: list[tuple[int, tuple[float, float, float, float]]]
    presence: float

    @property
    def x(self) -> float:
        return median(b[1][0] for b in self.boxes)

    @property
    def w(self) -> float:
        return median(b[1][2] for b in self.boxes)

    def left(self, boxes=None) -> float:
        return min(b[1][0] - b[1][2] / 2 for b in (boxes or self.boxes))

    def right(self, boxes=None) -> float:
        return max(b[1][0] + b[1][2] / 2 for b in (boxes or self.boxes))

    def span(self) -> tuple[float, float]:
        """Where the face usually is (10th..90th percentile of its edges).

        The extremes include every lean and stray detection over the shot,
        which made two people standing side by side look too far apart to
        frame together, so the camera chased whoever it thought was talking
        and cut the other in half.
        """
        ls = sorted(b[1][0] - b[1][2] / 2 for b in self.boxes)
        rs = sorted(b[1][0] + b[1][2] / 2 for b in self.boxes)
        k = len(ls) // 10
        return ls[k], rs[len(rs) - 1 - k]

    def body(self) -> tuple[float, float]:
        """Their shoulders, not just their face: what a frame edge must not slice."""
        lo, hi = self.span()
        half = self.w * BODY_WIDTH / 2
        return min(lo, self.x - half), max(hi, self.x + half)

    def x_at(self, ms: int) -> float:
        """Where this face is at `ms`, interpolated between detections."""
        bs = self.boxes
        if ms <= bs[0][0]:
            return bs[0][1][0]
        for (t0, b0), (t1, b1) in zip(bs, bs[1:]):
            if t0 <= ms <= t1:
                k = (ms - t0) / (t1 - t0) if t1 > t0 else 0.0
                return b0[0] + k * (b1[0] - b0[0])
        return bs[-1][1][0]

    def w_at(self, ms: int) -> float:
        return min(self.boxes, key=lambda b: abs(b[0] - ms))[1][2]


#: Shots shorter than this are not reframed on their own. Handheld footage
#: (a hand drawing, a phone walking) trips the cut detector again and again;
#: reframing on each made the picture jump every few frames, down to
#: single-frame "shots". A real shot this short is gone before anyone notices
#: it kept the previous framing.
MIN_SHOT_MS = 400


def shots(cuts: list[int], start_ms: int, end_ms: int) -> list[tuple[int, int]]:
    """The clip split at its camera cuts (cuts too close together count once)."""
    edges = [start_ms]
    for c in sorted(c for c in set(cuts) if start_ms < c < end_ms):
        if c - edges[-1] >= MIN_SHOT_MS:
            edges.append(c)
    if len(edges) > 1 and end_ms - edges[-1] < MIN_SHOT_MS:
        edges.pop()
    edges.append(end_ms)
    return [(a, b) for a, b in zip(edges, edges[1:]) if b > a]


#: Detections this close to a shot's edge can belong to the shot on the other
#: side of the cut (the cut is pinned to the exact frame, detections are a few
#: frames apart). Someone seen only there is not in this shot.
EDGE_GUARD_MS = 250


def people_in(tracks, start_ms: int, end_ms: int) -> list[Person]:
    """Who is on screen in one shot, flimsy detections left out."""
    found = []
    edge_only: set = set()
    long_shot = end_ms - start_ms >= 4 * EDGE_GUARD_MS
    for t in tracks:
        boxes = [b for b in t.boxes if start_ms <= b[0] < end_ms]
        if not boxes:
            continue
        if long_shot and all(b[0] < start_ms + EDGE_GUARD_MS or b[0] >= end_ms - EDGE_GUARD_MS for b in boxes):
            edge_only.add(t.id)
        found.append((t.id, boxes))
    # Drop the edge-only ones, but only when someone is properly in the shot
    # (clip-level fallback tracks are only known at the clip's two ends).
    if edge_only and any(tid not in edge_only for tid, _ in found):
        found = [(tid, b) for tid, b in found if tid not in edge_only]
    if not found:
        return []
    most = max(len(b) for _, b in found)
    out = [Person(tid, boxes, len(boxes) / most) for tid, boxes in found]
    kept = [p for p in out if p.presence >= MIN_PRESENCE or most <= 2]
    return kept or out


def _clamp_to_frame(c: float, window: float) -> float:
    half = window / 2
    return min(1.0 - half, max(half, c))


def _fits(lo: float, hi: float, window: float) -> bool:
    return hi - lo <= window * (1 - 2 * EDGE_MARGIN)


def _hold(lo: float, hi: float, aim: float, window: float) -> float:
    """A fixed window that keeps [lo, hi] inside, as near `aim` as allowed."""
    m = window * EDGE_MARGIN
    lowest = hi - window / 2 + m          # further left and hi falls out
    highest = lo + window / 2 - m         # further right and lo falls out
    if lowest > highest:                  # wider than the window: centre it
        return _clamp_to_frame((lo + hi) / 2, window)
    return _clamp_to_frame(min(highest, max(lowest, aim)), window)


def _avoid_slivers(c: float, lo: float, hi: float, others: list[Person], window: float) -> float:
    """Move a held window so nobody else is cut in half at its edge.

    Either step off the other face or take it in whole, whichever is the
    smaller move that still holds the subject properly.
    """
    m = window * EDGE_MARGIN
    for _ in range(3):
        moved = False
        for o in others:
            ol, orr = o.body()
            wl, wr = c - window / 2, c + window / 2
            if orr <= wl or ol >= wr or (ol >= wl and orr <= wr):
                continue                       # outside, or whole: fine
            options = [
                ol - OTHER_MARGIN - window / 2,  # window ends before their face
                orr + OTHER_MARGIN + window / 2,  # window starts after it
                orr + OTHER_MARGIN - window / 2,  # their face inside, at the right
                ol - OTHER_MARGIN + window / 2,   # their face inside, at the left
            ]
            ok = [x for x in options
                  if x - window / 2 >= -1e-9 and x + window / 2 <= 1 + 1e-9
                  and lo >= x - window / 2 + m / 2 and hi <= x + window / 2 - m / 2]
            if ok:
                c = min(ok, key=lambda x: abs(x - c))
                moved = True
        if not moved:
            break
    return c


def _subject_spans(shot: tuple[int, int], cast: list[Person], turns_, use_turns: bool,
                   ) -> list[tuple[int, int, Person]]:
    """Who to frame across one shot, as stretches of (start, end, person)."""
    s0, s1 = shot
    ids = {p.id: p for p in cast}
    # Most prominent: largest face, most often seen. Faces nearer the camera
    # are the ones the shot is about.
    default = max(cast, key=lambda p: (p.w * p.presence, -abs(p.x - 0.5)))
    named: list[tuple[int, int, Person]] = []
    if use_turns:
        for t in turns_ or []:
            a, b = max(s0, t.start_ms), min(s1, t.end_ms)
            if b > a and t.track_id in ids:
                named.append((a, b, ids[t.track_id]))
    if not named:
        return [(s0, s1, default)]

    # Unnamed stretches keep the last person named in this shot; before the
    # first one, that first speaker (most likely already talking, just not yet
    # measurable). Nothing reaches across the cut.
    spans: list[tuple[int, int, Person]] = []
    cursor, current = s0, named[0][2]
    for a, b, who in named:
        if a > cursor:
            spans.append((cursor, a, current))
        spans.append((a, b, who))
        cursor, current = b, who
    if cursor < s1:
        spans.append((cursor, s1, current))

    # Interjections are absorbed by whoever holds the floor around them.
    merged: list[list] = []
    for a, b, who in spans:
        if merged and merged[-1][2].id == who.id:
            merged[-1][1] = b
        else:
            merged.append([a, b, who])
    changed = True
    while changed and len(merged) > 1:
        changed = False
        for i, (a, b, who) in enumerate(merged):
            if b - a >= MIN_HOLD_MS:
                continue
            j = i - 1 if i > 0 else i + 1
            merged[j][0] = min(merged[j][0], a)
            merged[j][1] = max(merged[j][1], b)
            del merged[i]
            changed = True
            break
        joined: list[list] = []
        for item in merged:
            if joined and joined[-1][2].id == item[2].id:
                joined[-1][1] = item[1]
            else:
                joined.append(item)
        merged = joined
    return [(a, b, who) for a, b, who in merged]


def _follow(a: int, b: int, who: Person, window: float) -> list[tuple[int, float]]:
    """A subject who moves further than a held window allows: ease after them,
    but never so slowly that they leave it."""
    m = window * EDGE_MARGIN
    out: list[tuple[int, float]] = []
    c: float | None = None
    for ms in range(a, b, FOLLOW_STEP_MS):
        x, w = who.x_at(ms), who.w_at(ms)
        target = _clamp_to_frame(x, window)
        c = target if c is None else c + FOLLOW_EASE * (target - c)
        # Hard limits: the face stays inside, clear of the edges.
        lowest = x + w / 2 - window / 2 + m
        highest = x - w / 2 + window / 2 - m
        if lowest <= highest:
            c = min(highest, max(lowest, c))
        else:
            c = x
        c = _clamp_to_frame(c, window)
        out.append((ms, round(c, 4)))
    return out


def plan_camera(tracks, turns_, cuts: list[int], start_ms: int, end_ms: int,
                window: float, *, use_turns: bool = True) -> list[tuple[int, float]]:
    """Where the window's centre sits over the clip, as (ms, 0..1 of width).

    `window` is the crop's width as a share of the source width (about 0.32
    for 9:16 out of 16:9). The result has a sample at the start of every shot
    and wherever the window moves; between samples it holds.
    """
    if window >= 1.0:
        return [(start_ms, 0.5)]
    out: list[tuple[int, float]] = []
    for shot in shots(cuts, start_ms, end_ms):
        s0, s1 = shot
        lead = s0 if s0 == start_ms else max(start_ms, s0 - CUT_LEAD_MS)
        cast = people_in(tracks, s0, s1)
        if not cast:
            # Nobody to frame: a cutaway or a graphic. The middle is the
            # composition the shot was made for far more often than not.
            out.append((lead, 0.5))
            continue
        lo = min(p.span()[0] for p in cast)
        hi = max(p.span()[1] for p in cast)
        if _fits(lo, hi, window):
            c = _hold(lo, hi, (lo + hi) / 2, window)
            out.append((lead, round(c, 4)))
            continue
        first = True
        for a, b, who in _subject_spans(shot, cast, turns_, use_turns):
            at = lead if first else a
            first = False
            own = [bx for bx in who.boxes if a <= bx[0] < b] or who.boxes
            flo, fhi = who.left(own), who.right(own)
            others = [p for p in cast if p.id != who.id]
            if _fits(flo, fhi, window):
                c = _hold(flo, fhi, median(bx[1][0] for bx in own), window)
                c = _avoid_slivers(c, flo, fhi, others, window)
                out.append((at, round(c, 4)))
            else:
                path = _follow(a, b, who, window)
                if path:
                    out.append((at, path[0][1]))
                    out.extend(path[1:])
    # Drop samples that change nothing.
    tidy: list[tuple[int, float]] = []
    for ms, c in out:
        if tidy and abs(tidy[-1][1] - c) < 1e-4:
            continue
        tidy.append((ms, c))
    return tidy


def window_share(src_w: int, src_h: int, out_w: int, out_h: int) -> float:
    """How much of the source width a full-height crop of the output shape takes."""
    if not src_w or not src_h or not out_h:
        return 1.0
    return min(1.0, src_h * out_w / out_h / src_w)


def misses(samples: list[tuple[int, float]], tracks, turns_, cuts: list[int],
           start_ms: int, end_ms: int, window: float, *, use_turns: bool = True,
           ) -> list[tuple[int, int]]:
    """Detections of the framed subject that fall outside the window.

    Used by tests and logged by the render as a check: framing is right when
    this is empty. Returns (ms, track id) for every miss.
    """
    def centre_at(ms: int) -> float:
        c = samples[0][1] if samples else 0.5
        for t, x in samples:
            if t <= ms:
                c = x
            else:
                break
        return c

    bad = []
    for shot in shots(cuts, start_ms, end_ms):
        cast = people_in(tracks, *shot)
        if not cast:
            continue
        lo = min(p.left() for p in cast)
        hi = max(p.right() for p in cast)
        group = _fits(lo, hi, window)
        for a, b, who in ([(shot[0], shot[1], None)] if group else
                          _subject_spans(shot, cast, turns_, use_turns)):
            for p in (cast if who is None else [who]):
                for ms, (x, _y, w, _h) in p.boxes:
                    if not (a <= ms < b):
                        continue
                    c = centre_at(ms)
                    if x - w / 2 < c - window / 2 - 1e-6 or x + w / 2 > c + window / 2 + 1e-6:
                        bad.append((ms, p.id))
    return bad
