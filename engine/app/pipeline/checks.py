"""Checks on a shot plan that need no render: is the subject in frame, is any text sliced.

Both work on the plan and the analysis it was made from (shots.Inputs), so
the benchmark can score a layout in milliseconds and the style review can
tell the owner, in plain words, what a look would cost a clip.

- subject in frame: of every sighting of the shot's main person (their whole
  body box, from the object detector), the share whose body sits inside the
  crop. A crop on a walking man's head, or one that leaves him out, scores low.
- sliced text: of the time a crop is on screen, the share in which a held run
  of on-screen text (a name label, "DAY 1", a product caption) is cut by the
  crop's edge rather than kept whole or left out.

Whole-picture shots (fit, bars, headline) keep every body and every label,
so they score as perfect; the checks are about crops.
"""
from __future__ import annotations

from . import director
from . import shots as P

#: A body counts as in frame when this much of its width is inside the crop.
BODY_INSIDE = 0.8
#: A text box is sliced when the crop holds more than this and less than
#: (1 - this) of it, across or down.
SLICE_EDGE = 0.1
#: Crops a shot is drawn through, by kind (the boxes that cut the picture).
WHOLE = {"fit", "bars", "headline"}


def _x_at(shot: P.Shot, ms: int) -> "tuple[int, int, int, int] | None":
    """The fill/pip window (x, y, w, h) at a moment of its shot, following its pan or motion."""
    win = shot.window
    if win is None:
        return None
    if shot.motion:
        best = min(shot.motion, key=lambda m: abs(m[0] - ms))
        return best[1], best[2], best[3], best[4]
    x = win.x
    for at, px in shot.pan or []:
        if at <= ms:
            x = px
    return x, win.y, win.w, win.h


def _crops(shot: P.Shot, ms: int) -> list[tuple[int, int, int, int]]:
    """Every crop of the source drawn at this moment (pixels)."""
    out = []
    w = _x_at(shot, ms)
    if w is not None and shot.kind in {"fill", "pip"} and (shot.kind == "fill" or shot.base == "fill"):
        out.append(w)
    for c in shot.cells:
        out.append((c.x, c.y, c.w, c.h))
    if shot.kind in {"screen", "graphic", "feed"} and shot.main is not None:
        m = shot.main
        out.append((m.x, m.y, m.w, m.h))
    return out


def _inside(lo: float, hi: float, a: float, b: float) -> float:
    """The share of [lo, hi] that falls inside [a, b]."""
    span = hi - lo
    if span <= 0:
        return 1.0 if a <= lo <= b else 0.0
    return max(0.0, min(hi, b) - max(lo, a)) / span


def subject_in_frame(plan: list[P.Shot], inp: P.Inputs) -> "float | None":
    """Share of the main subject's body sightings that the crop holds; None with no bodies to judge."""
    if not inp.bodies:
        return None
    sw, sh = inp.width, inp.height
    seen = kept = 0
    for shot in plan:
        if shot.kind in WHOLE or (shot.kind == "pip" and shot.base == "fit"):
            continue
        if shot.kind not in {"fill", "pip"} or shot.window is None:
            continue
        cast = [p for p in director.people_in(inp.bodies, shot.start_ms, shot.end_ms)
                if len(p.boxes) >= 2]
        if not cast:
            continue
        # The person the shot is about: the one the window starts nearest.
        x0, _, w0, _ = _x_at(shot, shot.start_ms) or (0, 0, sw, sh)
        centre = (x0 + w0 / 2) / sw
        subject = min(cast, key=lambda p: (abs(p.x - centre), -p.w))
        for ms, (bx, _by, bw, _bh) in subject.boxes:
            crop = _x_at(shot, ms)
            if crop is None:
                continue
            x, _y, cw, _ch = crop
            seen += 1
            if _inside(bx - bw / 2, bx + bw / 2, x / sw, (x + cw) / sw) >= BODY_INSIDE:
                kept += 1
    return kept / seen if seen else None


def text_sliced(plan: list[P.Shot], inp: P.Inputs) -> "float | None":
    """Share of cropped screen time in which held on-screen text is cut by a crop edge; None with no text."""
    if not inp.texts:
        return None
    from . import graphics

    sw, sh = inp.width, inp.height
    total = sliced = 0
    for shot in plan:
        if shot.kind in WHOLE:
            continue
        texts = graphics.text_spans(inp.texts, shot.start_ms, shot.end_ms)
        crops = _crops(shot, shot.start_ms)
        if not crops:
            continue
        total += shot.length_ms
        if not texts:
            continue
        # Judged at the start, middle and end of the shot, so a pan that
        # slices a label half way through still counts.
        cut = False
        for ms in (shot.start_ms, (shot.start_ms + shot.end_ms) // 2, shot.end_ms - 1):
            for x, y, cw, ch in _crops(shot, ms):
                l, r, t, b = x / sw, (x + cw) / sw, y / sh, (y + ch) / sh
                for tx, ty, tw, th in texts:
                    across = _inside(tx, tx + tw, l, r)
                    down = _inside(ty, ty + th, t, b)
                    if across <= 0 or down <= 0:
                        continue            # left out entirely: fine
                    if SLICE_EDGE < across < 1 - SLICE_EDGE or SLICE_EDGE < down < 1 - SLICE_EDGE:
                        cut = True
        if cut:
            sliced += shot.length_ms
    return sliced / total if total else 0.0
