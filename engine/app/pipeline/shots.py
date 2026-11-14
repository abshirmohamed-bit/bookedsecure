"""The edit: what every shot of a clip looks like.

A clip used to get one layout from its first frame to its last. Real footage
does not hold still like that. A news segment cuts from a two-shot to a
close-up to a screenshot of a web page; an interview goes wide, then tight.
One answer for the whole clip is wrong for most of it: the screenshot is cut
to a sliver nobody can read, the wide shot leaves the speaker a speck, the
two-shot is centred on the gap between two people.

So the plan is made shot by shot, the way an editor cuts a vertical version:

- A shot of someone talking is a crop on them (director.py decides where),
  pushed in when they are small in the frame, with room above their head.
- Two people who share a shot and both talk are stacked, one cell each.
  Three or four, when the clip is about all of them, get a grid.
- A shot with nobody in it, whose detail runs right across the frame
  (screenshots, slides, graphics, a page of text), is fitted whole over a
  blurred copy of itself rather than cut down.
- A small face on top of a wide screen is a webinar or a screen share: the
  screen goes on top and the person below.

The layout the creator picks is a policy over the same shots: "auto" does all
of the above, "split" stacks whoever shares a shot, "grid" fits a group,
"screen" always puts the picture over the person, "pip" insets a second face,
and the fit/bars/headline layouts show every shot whole.

Everything here is arithmetic over what the analysis pass found (faces per
shot, cuts, turns, detail profiles), so it is cheap and testable without a
video. The render (compose.py) and the editor's preview both ask here, so
what the editor shows is what gets made.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

from . import director

#: Every layout policy the Engine understands. "one-feed" is not a choice a
#: creator makes: auto reaches it for a composite that is about one side.
LAYOUTS = ("auto", "full-video", "split", "grid", "screen", "pip", "streamer",
           "black-box", "title-subtitles")
ZOOMS = ("off", "auto", "moments")
#: What the clip is about, which decides who has to be on screen.
WANTS_EVERYONE = {"reaction", "everyone"}

#: A face this high, as a share of the output height, reads as a medium
#: close-up on a phone (forehead to chin about a fifth of the frame).
#: Smaller than this in a wide shot and we push in.
TARGET_FACE_H = 0.18
#: Pushing in less than this is not worth the softness it costs.
MIN_ZOOM = 1.12
#: How far a crop may be enlarged on its way to the output before it looks
#: soft. A 4K source has room to push in a long way; a 1080p one is already
#: enlarged to fill a vertical frame, so it gets a little regardless (MIN_CAP),
#: because a speck of a speaker is worse than a slightly soft one.
MAX_UPSCALE = 1.7
MIN_CAP, MAX_CAP = 1.2, 2.0
#: A punch-in on a line ("zoom-in moments") goes this much tighter.
PUNCH = 1.2
#: Lines shorter than this are not worth a punch-in; shots shorter than
#: PUNCH_SHOT keep one framing throughout.
PUNCH_MIN_MS = 2400
PUNCH_SHOT_MS = 4500
#: Where a face sits in a pushed-in crop, from the top: room for the head,
#: and the eyes near the upper third where people look.
HEADROOM = 0.40
#: Detail profiles: below this mean edge density there is nothing to cut off.
DETAIL_FLOOR = 0.015
#: A shot is shown whole when a crop would lose more than a tenth of its
#: detail (a line of text off the edge is a line nobody can read)...
DETAIL_KEEP = 0.9
#: ...and the shot is mostly plain between its edges, as text, slides,
#: screenshots and flat graphics are (measured: a slide 0.92, a test card
#: 0.93, a news studio 0.57). A studio or a street has edges everywhere and
#: nothing plain, and is cropped like any other picture.
FLAT_FOR_FIT = 0.75
#: A face narrower than this share of the frame, over wide content, is a
#: camera inset on a screen rather than the subject of the shot.
SMALL_FACE_W = 0.10
#: Both people have to hold the floor this long in a shot to be stacked.
BOTH_TALK_MS = 1500


@dataclass
class Box:
    """A crop in source pixels."""
    x: int
    y: int
    w: int
    h: int

    def crop(self, name: str = "") -> str:
        at = f"@{name}" if name else ""
        return f"crop{at}={self.w}:{self.h}:{self.x}:{self.y}"

    def as_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


@dataclass
class Shot:
    """One stretch of the clip and how it is composed. Times are source ms."""
    start_ms: int
    end_ms: int
    #: fill | fit | bars | headline | split | grid | screen | pip | feed | graphic
    kind: str
    #: fill (and a pip's main picture): the crop at its first position...
    window: Box | None = None
    #: ...and where it moves to, as (ms, x).
    pan: list[tuple[int, int]] = field(default_factory=list)
    #: split and grid: one crop per cell, in reading order.
    cells: list[Box] = field(default_factory=list)
    #: screen: the person below the picture; feed: the side of a composite.
    main: Box | None = None
    #: pip: the second face, drawn small over the main picture.
    inset: Box | None = None
    #: pip: what the main picture is ("fill" follows a person, "fit" shows
    #: the whole frame).
    base: str = "fill"
    zoom: float = 1.0
    why: str = ""
    #: Per-frame crops (source ms, x, y, w, h) from camera.apply: glides,
    #: breathing zoom and punch-ins. Empty: the crop holds `window`/`pan`.
    motion: list[tuple[int, int, int, int, int]] = field(default_factory=list)
    #: How this shot comes in (an ffmpeg xfade name), None for a straight cut.
    transition: str | None = None
    #: pip: which side of the frame the bubble sits on ("right" or "left"),
    #: away from the face in the main picture.
    side: str = "right"

    @property
    def length_ms(self) -> int:
        return self.end_ms - self.start_ms

    def as_dict(self, offset_ms: int = 0) -> dict:
        return {
            "start_ms": self.start_ms - offset_ms, "end_ms": self.end_ms - offset_ms,
            "kind": self.kind, "base": self.base if self.kind == "pip" else None,
            "zoom": round(self.zoom, 3), "why": self.why,
            "window": self.window.as_dict() if self.window else None,
            "pan": [[ms - offset_ms, x] for ms, x in self.pan],
            "cells": [c.as_dict() for c in self.cells],
            "main": self.main.as_dict() if self.main else None,
            "inset": self.inset.as_dict() if self.inset else None,
            "transition": self.transition,
            "side": self.side if self.kind == "pip" else None,
            "motion": [[m[0] - offset_ms, *m[1:]] for m in _thin(self.motion)],
        }


def _thin(motion: list, every: int = 3) -> list:
    """Every `every`th frame of a motion path, for the editor (it interpolates)."""
    if not motion:
        return []
    kept = motion[::every]
    if kept[-1] != motion[-1]:
        kept.append(motion[-1])
    return kept


@dataclass
class Inputs:
    """Everything the plan is made from."""
    width: int                      # source, px
    height: int
    out_w: int                      # output frame, px
    out_h: int
    in_ms: int
    out_ms: int
    tracks: list = field(default_factory=list)      # speaker.FaceTrack
    turns: list = field(default_factory=list)       # speaker.Turn
    cuts: list[int] = field(default_factory=list)
    detail: list = field(default_factory=list)      # (ms, [bins])
    #: The clip-level track: motion samples when no faces could be read, and
    #: the composite seam.
    track: object | None = None
    layout: str = "auto"
    focus: str = "auto"
    zoom: str = "auto"
    #: Caption words, clip-relative, for zoom-in moments.
    words: list | None = None
    #: On-screen cards (graphics.sightings): (ms, [(x, y, w, h) shares]).
    cards: list = field(default_factory=list)
    #: Where burned-in subtitles start (share of the height), if the video has them:
    #: crops end above it (graphics.subtitle_top).
    subtitle_top: float | None = None
    #: The real picture inside added black bars (graphics.letterbox), as
    #: (x0, y0, x1, y1) shares, or None when the source has no bars.
    active: tuple | None = None
    #: Whole-body person tracks (speaker.FaceTrack, boxes as centre/size shares),
    #: from the object detector. Empty when it isn't installed.
    bodies: list = field(default_factory=list)
    #: On-screen text (graphics.text_boxes): (ms, [(x, y, w, h) shares]).
    texts: list = field(default_factory=list)
    #: Share of the clip with a voice (vad.share), None when it can't be told.
    voiced: float | None = None


# ------------------------------------------------------------------ geometry

def _even(v: float) -> int:
    v = int(round(v))
    return max(2, v - v % 2)


def full_window(sw: int, sh: int, out_w: int, out_h: int) -> tuple[int, int]:
    """The largest crop of the output's shape that fits the source."""
    target = out_w / out_h
    if sw / sh > target:
        return _even(sh * target), _even(sh)
    return _even(sw), _even(sw / target)


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


@dataclass
class _Face:
    """One person within one shot, summarised."""
    id: int
    x: float
    y: float
    w: float
    h: float
    presence: float

    @property
    def left(self) -> float:
        return self.x - self.w / 2

    @property
    def right(self) -> float:
        return self.x + self.w / 2


def _faces(cast: list[director.Person]) -> list[_Face]:
    out = []
    for p in cast:
        bs = [b[1] for b in p.boxes]
        out.append(_Face(p.id, median(b[0] for b in bs), median(b[1] for b in bs),
                         median(b[2] for b in bs), median(b[3] for b in bs), p.presence))
    return out


def _prominent(faces: list[_Face]) -> list[_Face]:
    """Largest and most often seen first: the people the shot is about."""
    return sorted(faces, key=lambda f: (-(f.w * f.presence), abs(f.x - 0.5)))


def _talk_time(turns_, start_ms: int, end_ms: int) -> dict[int, int]:
    held: dict[int, int] = {}
    for t in turns_ or []:
        if t.track_id is None:
            continue
        a, b = max(start_ms, t.start_ms), min(end_ms, t.end_ms)
        if b > a:
            held[t.track_id] = held.get(t.track_id, 0) + (b - a)
    return held


def _zoom_cap(inp: Inputs) -> float:
    """How far this source can be pushed in before the picture goes soft.

    Measured against the full-size output of this shape (1080 wide for a
    vertical or square clip), not the render's own size: a half-size preview
    and the editor's framing call must plan the same shot.
    """
    _, fh = full_window(inp.width, inp.height, inp.out_w, inp.out_h)
    nominal_h = 1080 if inp.out_w >= inp.out_h else round(1080 * inp.out_h / max(1, inp.out_w))
    base = nominal_h / max(1, fh)          # enlargement the output already needs
    return _clamp(MAX_UPSCALE / base, MIN_CAP, MAX_CAP)


#: A face narrower than this, with no body found around it, is pushed in at
#: most this far: a speck of a face is not a reason to blow up a wide shot.
TINY_FACE_W = 0.03
TINY_FACE_ZOOM = 1.3


def _auto_zoom(faces: list[_Face], inp: Inputs, share: float, bodies: list[_Face] | None = None) -> float:
    """Push in on a wide shot until the subject reads, never past the cap.

    When everyone in the shot fits the window, the push stops while they
    still all fit: a wide two-shot should get tighter, not lose a person.
    With body boxes, the push also stops while the subject's body still fits
    across the window, so a walking person is not cropped to a head.
    """
    if not faces:
        return 1.0
    subject = max(faces, key=lambda f: f.h)
    want = TARGET_FACE_H / max(subject.h, 1e-3)
    lo, hi = min(f.left for f in faces), max(f.right for f in faces)
    if director._fits(lo, hi, share):
        want = min(want, share * (1 - 2 * director.EDGE_MARGIN) / max(hi - lo, 1e-3))
    body = _body_of(subject, bodies or [])
    if body is not None:
        want = min(want, share * (1 - director.EDGE_MARGIN) / max(body.w, 1e-3))
    elif subject.w < TINY_FACE_W and _people_seen(inp):
        want = min(want, TINY_FACE_ZOOM)
    zoom = min(want, _zoom_cap(inp))
    return round(zoom, 3) if zoom >= MIN_ZOOM else 1.0


def _headroom_y(faces: list[_Face], centre: float, win_w: int, win_h: int,
                sw: int, sh: int) -> int:
    """Where a crop shorter than the source sits: the face high, not centred."""
    if win_h >= sh:
        return 0
    left = centre - win_w / sw / 2
    right = centre + win_w / sw / 2
    inside = [f for f in faces if left <= f.x <= right] or faces
    if not inside:
        return (sh - win_h) // 2
    cy = median(f.y for f in inside)
    y = cy * sh - HEADROOM * win_h
    return int(_clamp(round(y), 0, sh - win_h))


def _detail(inp: Inputs, start_ms: int, end_ms: int, share: float) -> tuple[bool, float]:
    """(would a crop cut the content apart, where the content is densest).

    The share of the shot's detail the best crop position keeps: a page of
    text or a slide keeps about a third of it in a 9:16 window, a person
    against a soft background nearly all of it.
    """
    entries = [e for e in inp.detail if start_ms <= e[0] < end_ms and e[1]]
    rows = [e[1] for e in entries]
    if not rows:
        return False, 0.5
    flats = [e[2] for e in entries if len(e) > 2]
    flat = sum(flats) / len(flats) if flats else 1.0
    n = len(rows[0])
    avg = [sum(r[i] for r in rows if len(r) == n) / len(rows) for i in range(n)]
    total = sum(avg)
    if total <= 0 or total / n < DETAIL_FLOOR:
        return False, 0.5
    span = max(1, min(n, round(share * n)))
    best, best_at = -1.0, 0
    for i in range(0, n - span + 1):
        s = sum(avg[i:i + span])
        if s > best:
            best, best_at = s, i
    centre = (best_at + span / 2) / n
    return best / total < DETAIL_KEEP and flat >= FLAT_FOR_FIT, centre


def _in_corner(f: _Face) -> bool:
    """A camera inset sits in a corner of the screen it is laid over."""
    return min(f.x, 1 - f.x) < 0.24 and (f.y - f.h / 2 < 0.14 or f.y + f.h / 2 > 0.84)


def _cell(face: _Face, aspect: float, face_share: float, inp: Inputs,
          band: tuple[float, float] = (0.0, 1.0)) -> Box:
    """A crop of `aspect` around one face, fenced inside `band` (0..1 of width)."""
    sw, sh = inp.width, inp.height
    lo, hi = band[0] * sw, band[1] * sw
    cw = min(hi - lo, float(sw), max(face.w * sw / face_share, 32.0))
    ch = cw / aspect
    if ch > sh:
        ch = float(sh)
        cw = ch * aspect
    limit = _subtitle_limit(inp)
    if limit is not None and ch > limit:
        ch, cw = float(limit), limit * aspect
    cw, ch = _even(cw), _even(ch)
    x = face.x * sw - cw / 2
    x = _clamp(x, lo, max(lo, hi - cw))
    x = _clamp(x, 0, sw - cw)
    y = _clamp(face.y * sh - 0.42 * ch, 0, (limit if limit is not None else sh) - ch)
    return Box(int(round(x)), int(round(y)), cw, ch)


def _bands(people: list[_Face]) -> list[tuple[float, float]]:
    """Each person's slice of the width, up to halfway to the next face."""
    out = []
    for i, f in enumerate(people):
        lo = 0.0 if i == 0 else (people[i - 1].right + f.left) / 2
        hi = 1.0 if i == len(people) - 1 else (f.right + people[i + 1].left) / 2
        out.append((lo, max(hi, lo + 0.02)))
    return out


# ------------------------------------------------------------------ people and text

#: A face this wide is trusted on its own; smaller ones need a body around them
#: when the person detector ran, or they are a kettle, a painting, a poster.
TRUSTED_FACE_W = 0.06
#: A faceless person (filmed from behind, in profile, walking away) is framed
#: with their body this tall in the window.
TARGET_BODY_H = 0.82
#: A title card is big text across the middle of the picture ("DAY 1"): at
#: least this tall and this wide, centred, or covering this much of the frame.
#: A name label in a corner is never a title, however bold its lettering.
TITLE_TEXT_H = 0.14
TITLE_TEXT_W = 0.30
TITLE_TEXT_AREA = 0.08
#: A faceless shot is "about" its activity when the busiest window holds this
#: many times its fair share of the motion; below it the middle is framed.
ACTIVITY_LEAD = 1.35
#: Motion (mean grey-level difference) above which a flat picture is not a
#: still screen: a screen recording with a cursor stays under it, a hand
#: drawing on paper does not.
STILL_SCREEN_MOTION = 2.0
#: A picture darker than this (mean grey level) is night footage, not a
#: screen or a slide: it is cropped like any other shot, never shown as one.
DARK_PICTURE = 60.0


def _brightness(inp: Inputs, a: int, b: int) -> "float | None":
    vals = [e[8] for e in inp.detail if a <= e[0] < b and len(e) > 8]
    return sum(vals) / len(vals) if vals else None


def _people_seen(inp: Inputs) -> bool:
    return bool(inp.bodies)


#: A body has to be found this many times in its shot (fewer in a short
#: shot): the object detector takes a cushion or a painting for a person in
#: the odd frame, and one sighting in fifty seconds is not someone in shot.
BODY_MIN_SIGHTINGS = 4


def _bodies_in(inp: Inputs, a: int, b: int) -> list[_Face]:
    if not inp.bodies:
        return []
    from .speaker import DETECT_MS

    need = max(1, min(BODY_MIN_SIGHTINGS, round(0.25 * (b - a) / DETECT_MS)))
    cast = [p for p in director.people_in(inp.bodies, a, b) if len(p.boxes) >= need]
    return _faces(cast)


def _body_of(face: _Face, bodies: list[_Face]) -> "_Face | None":
    """The body box the face sits in: its centre inside the box, in the head's place.

    Several boxes can hold one face (a person in front of another); the one
    whose top sits where this face's head is wins, so a face is not paired
    with the body of someone standing behind.
    """
    best, best_d = None, 9.0
    for bd in bodies:
        left, right = bd.x - bd.w / 2 - 0.02, bd.x + bd.w / 2 + 0.02
        top, bottom = bd.y - bd.h / 2 - 0.03, bd.y + bd.h / 2
        if not (left <= face.x <= right and top <= face.y <= bottom):
            continue
        if face.w > 0.75 * bd.w + 0.02:
            continue                    # a face wider than the body is not in it
        head = top + 0.03 + face.h / 2  # where this face's centre would be at the top of the box
        d = abs(face.y - head) / max(bd.h, 1e-3) + 0.3 * abs(face.x - bd.x) / max(bd.w, 1e-3)
        if face.y > top + 0.6 * bd.h + 0.03:
            continue
        if d < best_d:
            best, best_d = bd, d
    return best


def _body_track(face: _Face, inp: Inputs, a: int, b: int):
    """The body track that carries this face through the shot, if the detector saw one."""
    if not inp.bodies:
        return None
    cast = director.people_in(inp.bodies, a, b)
    by_id = {p.id: p for p in cast}
    bd = _body_of(face, _faces(cast))
    return by_id.get(bd.id) if bd is not None else None


def _real_faces(faces: list[_Face], bodies: list[_Face], inp: Inputs) -> list[_Face]:
    """Faces that belong to a person, when the person detector is there to say.

    A face the size of a thumb with no body around it is a kettle, a poster,
    a painting of an owl: every one of those has steered a crop.
    """
    if not _people_seen(inp):
        return faces
    kept = []
    for f in faces:
        if f.w >= TRUSTED_FACE_W or _body_of(f, bodies) is not None:
            kept.append(f)
    return kept


def bodies_beyond(face: _Face, bodies: list[_Face]) -> bool:
    """Whether people other than this face's own body are in shot (then it is a room, not a webcam)."""
    own = _body_of(face, bodies)
    return any(bd is not own for bd in bodies)


def _texts_in(inp: Inputs, a: int, b: int) -> list[tuple[float, float, float, float]]:
    if not inp.texts:
        return []
    from . import graphics

    return graphics.text_spans(inp.texts, a, b)


#: A title holds through most of its shot ("DAY 1" is the shot); text that
#: passes through a long shot is a sign or a label, not a title card.
TITLE_HOLD = 0.5


def _titles_in(inp: Inputs, a: int, b: int) -> list[tuple[float, float, float, float]]:
    if not inp.texts:
        return []
    from . import graphics

    return [box for box, held in graphics.text_runs(inp.texts, a, b) if held >= TITLE_HOLD * (b - a)]


def _is_title(texts: list[tuple[float, float, float, float]]) -> bool:
    for x, y, w, h in texts:
        cx, cy = x + w / 2, y + h / 2
        centred = 0.25 <= cx <= 0.75 and 0.12 <= cy <= 0.82
        if w * h >= TITLE_TEXT_AREA or (centred and h >= TITLE_TEXT_H and w >= TITLE_TEXT_W):
            return True
    return False


def _clear_of_text(shot: Shot, texts: list[tuple[float, float, float, float]], inp: Inputs,
                   lo: float, hi: float) -> Shot:
    """Never slice a label: a fill window takes each run of text in whole or leaves it out.

    Sideways first (the smaller move that keeps the subject [lo, hi] inside
    with its margin); a label that would be cut by the bottom of a pushed-in
    window opens the window back to full height instead.
    """
    if shot.kind != "fill" or shot.window is None or not texts:
        return shot
    sw, sh = inp.width, inp.height
    win = shot.window
    share = win.w / sw
    m = share * director.EDGE_MARGIN
    for t in texts:
        tl, tr, tt, tb = t[0], t[0] + t[2], t[1], t[1] + t[3]
        if t[2] > share * (1 - 2 * director.EDGE_MARGIN):
            continue                    # wider than the window: nothing sideways helps
        new_pan = []
        for ms, x in shot.pan or [(shot.start_ms, win.x)]:
            wl = x / sw
            wr = wl + share
            if tr <= wl or tl >= wr or (tl >= wl and tr <= wr):
                new_pan.append((ms, x))
                continue
            c = wl + share / 2
            options = [tl - 0.005 - share / 2, tr + 0.005 + share / 2, tr + 0.005 - share / 2, tl - 0.005 + share / 2]
            ok = [o for o in options if o - share / 2 >= -1e-9 and o + share / 2 <= 1 + 1e-9
                  and lo >= o - share / 2 + m / 2 and hi <= o + share / 2 - m / 2]
            if ok:
                c = min(ok, key=lambda o: abs(o - c))
            new_pan.append((ms, int(_clamp(round(c * sw - win.w / 2), 0, sw - win.w))))
        shot.pan = new_pan
        if new_pan:
            win.x = new_pan[0][1]
        # Vertical: a pushed-in window must not end across a line of text.
        if win.h < sh:
            top, bottom = win.y / sh, (win.y + win.h) / sh
            if tt < bottom < tb or tt < top < tb:
                full_w, full_h = full_window(sw, sh, inp.out_w, inp.out_h)
                cx = win.x + win.w / 2
                win.w, win.h, win.y = full_w, full_h, 0
                win.x = int(_clamp(round(cx - full_w / 2), 0, sw - full_w))
                shot.pan = [(ms, int(_clamp(round(x + (win.w - full_w) / 2), 0, sw - full_w))) for ms, x in shot.pan]
                shot.zoom = 1.0
                shot.why += ", opened up for the text on screen"
    return shot


def _activity_profile(inp: Inputs, a: int, b: int):
    """(columns of motion 0..1, mean motion level, camera shift share) over a shot, or None."""
    entries = [e for e in inp.detail if a <= e[0] < b and len(e) > 7 and e[5]]
    if not entries:
        return None
    cols = None
    for e in entries:
        grid = e[5]
        col = [sum(row[i] for row in grid) for i in range(len(grid[0]))]
        cols = col if cols is None else [x + y for x, y in zip(cols, col)]
    peak = max(cols) or 1.0
    level = sum(e[7] for e in entries) / len(entries)
    shift = sum(e[6] for e in entries) / len(entries)
    return [c / peak for c in cols], level, shift


def _activity_centre(inp: Inputs, a: int, b: int, share: float) -> "tuple[float, float] | None":
    """Where a faceless shot's action is: (centre 0..1, lead over a fair share), or None without data."""
    prof = _activity_profile(inp, a, b)
    if prof is None:
        return None
    cols, _level, _shift = prof
    # Motion plus a little of the static detail, so a still product on a plain
    # table still pulls the window towards itself.
    rows = [e[1] for e in inp.detail if a <= e[0] < b and e[1]]
    n = len(cols)
    edges = [0.0] * n
    if rows:
        k = len(rows[0])
        avg = [sum(r[i] for r in rows if len(r) == k) / len(rows) for i in range(k)]
        top = max(avg) or 1.0
        edges = [avg[min(k - 1, int(i * k / n))] / top for i in range(n)]
    # The window is chosen on motion with a little static detail as the
    # tie-breaker; how decisive the choice is ("lead") is judged on the motion
    # alone, so detail spread evenly over the picture cannot water it down.
    score = [mv + 0.15 * ed for mv, ed in zip(cols, edges)]
    total_m = sum(cols)
    if total_m <= 0 or sum(score) <= 0:
        return None
    span = max(1, min(n, round(share * n)))
    best, best_at = -1.0, 0
    for i in range(0, n - span + 1):
        s = sum(score[i:i + span])
        if s > best:
            best, best_at = s, i
    lead = (sum(cols[best_at:best_at + span]) / total_m) / (span / n)
    return (best_at + span / 2) / n, lead


def _activity_pan(inp: Inputs, a: int, b: int, share: float) -> list[tuple[int, float]]:
    """The action's centre over a shot, sample by sample, eased so the window follows a moving hand."""
    entries = [e for e in inp.detail if a <= e[0] < b and len(e) > 7 and e[5]]
    out: list[tuple[int, float]] = []
    held: float | None = None
    for e in entries:
        grid = e[5]
        n = len(grid[0])
        col = [sum(row[i] for row in grid) for i in range(n)]
        total = sum(col)
        if total <= 0:
            continue
        c = sum((i + 0.5) / n * v for i, v in enumerate(col)) / total
        c = _clamp(c, share / 2, 1 - share / 2)
        if held is None:
            held = c
        elif abs(c - held) > 0.08:            # dead zone: a wobble does not move the camera
            held += 0.5 * (c - held)
        out.append((e[0], round(held, 4)))
    return out


def _fill_body(inp: Inputs, a: int, b: int, bodies: list[_Face], why: str) -> Shot:
    """A person with no face to read (from behind, in profile, walking off): framed on their body."""
    sw, sh = inp.width, inp.height
    fw, fh = full_window(sw, sh, inp.out_w, inp.out_h)
    subject = max(bodies, key=lambda f: f.w * f.h * f.presence)
    want = TARGET_BODY_H * sh / max(subject.h * sh, 1.0) * (fh / sh)
    zoom = _clamp(want, 1.0, _zoom_cap(inp)) if inp.zoom in {"auto", "moments"} else 1.0
    if zoom < MIN_ZOOM:
        zoom = 1.0
    ww, wh = _even(fw / zoom), _even(fh / zoom)
    share = ww / sw
    ids = {f.id for f in bodies}
    samples = director.plan_camera([t for t in inp.bodies if t.id in ids], [], [], a, b, share, use_turns=False) or [(a, subject.x)]
    pan = [(ms, int(_clamp(round(c * sw - ww / 2), 0, sw - ww))) for ms, c in samples]
    top = (subject.y - subject.h / 2) * sh
    y = int(_clamp(round(top - 0.06 * wh), 0, sh - wh)) if wh < sh else 0
    first = pan[0][1]
    return Shot(a, b, "fill", window=Box(first, y, ww, wh), pan=[(a, first), *pan[1:]], zoom=zoom,
                why=why + (f", pushed in {zoom:.2f}x" if zoom > 1 else ""))


# ------------------------------------------------------------------ shot kinds

def _fill(inp: Inputs, a: int, b: int, faces: list[_Face], *, use_turns: bool,
          zoom: float, why: str, tracks: list | None = None) -> Shot:
    sw, sh = inp.width, inp.height
    fw, fh = full_window(sw, sh, inp.out_w, inp.out_h)
    ww, wh = _even(fw / zoom), _even(fh / zoom)
    limit = _subtitle_limit(inp)
    if limit is not None and wh > limit:
        # Push in just enough that the crop ends above the burned-in subtitles.
        zoom *= wh / limit
        ww, wh = _even(fw / zoom), _even(fh / zoom)
    share = ww / sw
    if tracks:
        # A single person whose body was seen: the body carries the crop, a
        # tiny profile face does not (it is lost whenever they turn or walk).
        samples = director.plan_camera(tracks, [], [], a, b, share, use_turns=False)
    elif faces:
        samples = director.plan_camera(inp.tracks, inp.turns, [], a, b, share,
                                       use_turns=use_turns)
    else:
        samples = [(a, 0.5)]
    if not samples:
        samples = [(a, 0.5)]
    pan = [(ms, int(_clamp(round(c * sw - ww / 2), 0, sw - ww))) for ms, c in samples]
    centre = median(c for _, c in samples)
    y = _headroom_y(faces, centre, ww, wh, sw, sh) if wh < sh else 0
    if limit is not None:
        y = int(_clamp(y, 0, limit - wh))
    first = pan[0][1]
    moves = [(ms, x) for ms, x in pan[1:]]
    return Shot(a, b, "fill", window=Box(first, y, ww, wh), pan=[(a, first), *moves],
                zoom=zoom, why=why)


def _faceless_fill(inp: Inputs, a: int, b: int, centre: float, share: float, before: list[Shot]) -> Shot:
    """A close-up with nobody in it: the middle, unless the content clearly sits elsewhere.

    The busiest strip of a hand-drawing video is the printed form beside the
    drawing, not the drawing; the middle is what the camera was pointed at far
    more often. And neighbouring shots of the same thing keep one framing, so
    a handheld camera doesn't make the crop hop about.
    """
    sw = inp.width
    strong = _detail_lead(inp, a, b, share) >= FACELESS_LEAD
    aim = centre if strong else 0.5
    prev = before[-1] if before else None
    if prev is not None and prev.kind == "fill" and prev.why.startswith("nobody in shot") and prev.window is not None:
        held = (prev.window.x + prev.window.w / 2) / sw
        if abs(held - aim) < FACELESS_STICK:
            aim = held
    why = "nobody in shot: the busiest part of the picture" if strong else "nobody in shot: the middle of the picture"
    shot = _fill_centred(inp, a, b, aim, why)
    return _scan(shot, inp, len(before))


#: A faceless shot this long drifts slowly across the picture (a house tour, a
#: landscape, a product on a bench) instead of holding a frozen strip of it.
SCAN_MIN_MS = 2500
#: How fast, in source pixels a second, and how far at most (share of the width).
SCAN_SPEED = 40.0
SCAN_MAX = 0.10


def _scan(shot: Shot, inp: Inputs, index: int) -> Shot:
    """A slow drift across a faceless shot, alternating direction shot to shot.

    Sampled densely so the camera follows it as one smooth move (camera.py
    smooths dense samples rather than gliding between them).
    """
    if shot.window is None or shot.length_ms < SCAN_MIN_MS or inp.layout not in {"auto", "full-video"}:
        return shot
    sw = inp.width
    ww = shot.window.w
    free = sw - ww
    if free <= 0:
        return shot
    travel = min(SCAN_SPEED * shot.length_ms / 1000, SCAN_MAX * sw, free)
    if travel < 24:
        return shot
    x0 = shot.window.x
    direction = 1 if index % 2 == 0 else -1
    start = _clamp(x0 - direction * travel / 2, 0, free)
    end = _clamp(start + direction * travel, 0, free)
    from . import camera

    pan = []
    for ms in range(shot.start_ms, shot.end_ms, 100):
        u = (ms - shot.start_ms) / max(1, shot.length_ms)
        pan.append((ms, int(round(start + (end - start) * camera.ease_in_out(u)))))
    shot.pan = pan
    shot.window.x = pan[0][1]
    shot.why += ", drifting slowly across it"
    return shot


#: How much more detail than its share the busiest strip must hold to be framed instead of the middle.
FACELESS_LEAD = 2.2
#: Neighbouring faceless shots aimed closer than this (share of width) keep one framing.
FACELESS_STICK = 0.2


def _detail_lead(inp: Inputs, start_ms: int, end_ms: int, share: float) -> float:
    """How much of the detail the busiest window-wide strip holds, over its fair share."""
    rows = [e[1] for e in inp.detail if start_ms <= e[0] < end_ms and e[1]]
    if not rows:
        return 0.0
    n = len(rows[0])
    avg = [sum(r[i] for r in rows if len(r) == n) / len(rows) for i in range(n)]
    total = sum(avg)
    if total <= 0:
        return 0.0
    span = max(1, min(n, round(share * n)))
    best = max(sum(avg[i:i + span]) for i in range(0, n - span + 1))
    return (best / total) / (span / n)


def _fill_centred(inp: Inputs, a: int, b: int, centre: float, why: str) -> Shot:
    sw, sh = inp.width, inp.height
    ww, wh = full_window(sw, sh, inp.out_w, inp.out_h)
    y = (sh - wh) // 2
    limit = _subtitle_limit(inp)
    if limit is not None and y + wh > limit:
        if wh > limit:
            ww, wh = _even(ww * limit / wh), _even(limit)
        y = int(_clamp(y, 0, limit - wh))
    x = int(_clamp(round(centre * sw - ww / 2), 0, sw - ww))
    return Shot(a, b, "fill", window=Box(x, y, ww, wh), pan=[(a, x)], why=why)


def _subtitle_limit(inp: Inputs) -> "int | None":
    """The lowest source row a crop may reach: above burned-in subtitles, if any."""
    if inp.subtitle_top is None or not 0.5 < inp.subtitle_top < 1:
        return None
    return int(inp.subtitle_top * inp.height)


def _split(inp: Inputs, a: int, b: int, faces: list[_Face], why: str) -> Shot:
    two = sorted(_prominent(faces)[:2], key=lambda f: f.x)
    portrait = inp.out_h >= inp.out_w
    aspect = inp.out_w / (inp.out_h / 2) if portrait else (inp.out_w / 2) / inp.out_h
    cells = [_cell(f, aspect, 0.20, inp, band) for f, band in zip(two, _bands(two))]
    return Shot(a, b, "split", cells=cells, why=why)


def _grid(inp: Inputs, a: int, b: int, faces: list[_Face], why: str) -> Shot:
    people = sorted(_prominent(faces)[:4], key=lambda f: f.x)
    if len(people) == 3 and inp.out_h >= inp.out_w:
        # Spotlight: whoever talks most here gets the big card on top, the
        # other two share the bottom (looks.spotlight_cards), left to right.
        talk = _talk_time(inp.turns, a, b)
        lead = max(people, key=lambda f: (talk.get(f.id, 0), f.w * f.presence))
        rest = [f for f in people if f.id != lead.id]
        bands = dict(zip([f.id for f in people], _bands(people)))
        top = _cell(lead, inp.out_w / (inp.out_h * 0.56), 0.26, inp, bands[lead.id])
        below = [_cell(f, (inp.out_w / 2) / (inp.out_h * 0.44), 0.30, inp, bands[f.id]) for f in rest]
        return Shot(a, b, "grid", cells=[top, *below], main=top, why=why + ", the one talking in the spotlight")
    people = people[:4]
    aspect, share = inp.out_w / inp.out_h, 0.34
    cells = [_cell(f, aspect, share, inp, band) for f, band in zip(people, _bands(people))]
    return Shot(a, b, "grid", cells=cells, why=why)


#: A screen + zoom close-up shows this share of the source's height.
ZOOM_HEIGHT = 0.6


def _activity_zoom(inp: Inputs, a: int, b: int, centre: float) -> "Box | None":
    """The close-up for a faceless shot of a wide picture shown on a tall frame:
    a crop of the bottom card's shape, ZOOM_HEIGHT of the picture tall, on the
    densest columns and the busier half. None when the frame isn't tall or the
    source isn't wide (then the whole picture already fills the frame)."""
    sw, sh = inp.width, inp.height
    if not sw or not sh or inp.out_h <= inp.out_w or sw <= sh:
        return None
    entries = [e for e in inp.detail if a <= e[0] < b and e[1]]
    if not entries:
        return None
    top, bottom = screen_split(inp)
    aspect = inp.out_w / max(1, bottom)                       # the bottom card's shape
    ch = _even(sh * ZOOM_HEIGHT)
    cw = _even(min(sw, ch * aspect))
    bands = [(e[3], e[4]) for e in entries if len(e) > 4]
    top_busy = sum(t for t, _ in bands) / len(bands) if bands else 0.5
    bottom_busy = sum(bm for _, bm in bands) / len(bands) if bands else 0.5
    # Lean towards the busier band, never off the picture.
    cy = 0.5 + 0.18 * max(-1.0, min(1.0, (bottom_busy - top_busy) * 4))
    x = int(_clamp(round(centre * sw - cw / 2), 0, sw - cw))
    limit = _subtitle_limit(inp)
    y = int(_clamp(round(cy * sh - ch / 2), 0, (limit if limit is not None and limit >= ch else sh) - ch))
    return Box(x, y, cw, ch)


#: A piece of a shot shorter than this is folded into its neighbour.
MIN_PIECE_MS = 1500


def screen_split(inp: Inputs) -> tuple[int, int]:
    """(picture height, person height) for the screen layout, in output px."""
    top = _even(inp.out_w * inp.height / max(1, inp.width))
    top = min(top, _even(inp.out_h * 0.5))
    return top, inp.out_h - top


#: A face this wide fills the picture: the screen layout's top card would show
#: the same person again, so the shot follows the speaker instead...
CLOSE_UP_W = 0.07
#: ...and a face narrower than this makes a speaker card of wall and door.
SPEAKER_MIN_W = 0.03


def _screen_region(face: _Face, inp: Inputs) -> "Box | None":
    """The screen beside a small corner face (a webinar, a game stream): the
    picture with the face's side taken off, so the top card shows the screen
    and the face appears once, below. None when it would leave too little."""
    if not _in_corner(face):
        return None
    sw, sh = inp.width, inp.height
    if face.x < 0.5:
        x0, x1 = face.right + 0.02, 1.0
    else:
        x0, x1 = 0.0, face.left - 0.02
    if x1 - x0 < 0.6:
        return None
    return Box(int(x0 * sw), 0, _even((x1 - x0) * sw), _even(sh))


def _screen(inp: Inputs, a: int, b: int, faces: list[_Face], why: str) -> Shot:
    talk = _talk_time(inp.turns, a, b)
    order = _prominent(faces)
    subject = max(order, key=lambda f: (talk.get(f.id, 0), f.w * f.presence))
    _, bottom = screen_split(inp)
    aspect = inp.out_w / max(2, bottom)
    main = _cell(subject, aspect, 0.30, inp)
    region = _screen_region(subject, inp) if subject.w < SMALL_FACE_W * 1.4 else None
    return Shot(a, b, "screen", main=main, cells=[region] if region else [], why=why)


#: Nobody seen for this long at a shot's start or end is a dissolve the cut
#: detector missed (a product shot fading into an interview): split there.
PRESENCE_GAP_MS = 1500


def _split_on_presence(inp: Inputs, shots_):
    """Camera shots, further split where people fade in or out of an otherwise uncut stretch.

    A dissolve changes the picture too gradually to read as a cut, so the
    shot before it and the shot after it were planned as one: the crop sat
    where the speaker would appear while the product was still on screen.
    """
    for a, b in shots_:
        seen = sorted(bx[0] for t in inp.tracks for bx in t.boxes if a <= bx[0] < b)
        if len(seen) < 3:
            yield a, b
            continue
        first, last = seen[0], seen[-1]
        cut_in = first - 150 if first - a >= PRESENCE_GAP_MS else None
        cut_out = last + 150 if b - last >= PRESENCE_GAP_MS else None
        edges = [a] + [c for c in (cut_in, cut_out) if c is not None] + [b]
        for x, y in zip(edges, edges[1:]):
            if y > x:
                yield x, y


#: A split cell may enlarge its crop this much at most before it looks like mush.
MAX_CELL_UPSCALE = 2.6


def _too_small_to_split(faces: list[_Face], inp: Inputs) -> bool:
    """Would the two cells of a split have to enlarge their faces past what stays sharp?"""
    two = _prominent(faces)[:2]
    cell_w = inp.out_w if inp.out_h >= inp.out_w else inp.out_w / 2
    crop_w = min(f.w * inp.width / 0.20 for f in two)       # _split's face share
    return cell_w / max(1.0, crop_w) > MAX_CELL_UPSCALE


def _with_cards(inp: Inputs, shots_, layout: str):
    """Each camera shot as (from, to, card box or None): split where a card holds still."""
    from . import graphics

    portrait = inp.out_h >= inp.out_w
    for a, b in shots_:
        found = graphics.spans(inp.cards, a, b) if inp.cards and portrait and layout == "auto" else []
        cursor = a
        for ca, cb, share in found:
            if ca - cursor < MIN_PIECE_MS:
                ca = cursor                 # no sliver of a shot before the card
            if b - cb < MIN_PIECE_MS:
                cb = b
            if ca > cursor:
                yield cursor, ca, None
            yield ca, cb, _card_box(share, inp)
            cursor = cb
        if cursor < b:
            yield cursor, b, None


def _card_box(share: tuple[float, float, float, float], inp: Inputs) -> Box:
    """A card's box in source px, with a little room around it."""
    sw, sh = inp.width, inp.height
    pad = 0.012
    x0, y0 = max(0.0, share[0] - pad), max(0.0, share[1] - pad * sw / sh)
    x1, y1 = min(1.0, share[0] + share[2] + pad), min(1.0, share[1] + share[3] + pad * sw / sh)
    return Box(int(x0 * sw), int(y0 * sh), _even((x1 - x0) * sw), _even((y1 - y0) * sh))


def _graphic(inp: Inputs, a: int, b: int, faces: list[_Face], card: Box) -> Shot:
    """The person on top and the card they are answering whole below (looks.graphic_cards)."""
    from . import looks

    talk = _talk_time(inp.turns, a, b)
    subject = max(_prominent(faces), key=lambda f: (talk.get(f.id, 0), f.w * f.presence))
    person, _ = looks.graphic_cards(inp.out_w, inp.out_h, card.w, card.h)
    main = _clear_of_card(_cell(subject, person[2] / max(2, person[3]), 0.30, inp), subject, card, inp)
    return Shot(a, b, "graphic", main=main, inset=card,
                why="a card on screen: the person on top, the card whole below")


def _clear_of_card(main: Box, face: _Face, card: Box, inp: Inputs) -> Box:
    """Keep the person's crop off the card, which is shown whole below anyway.

    First slide sideways off it; failing that, end the crop above the card
    (a tighter shot of the same shape), as long as the face stays well inside.
    """
    def overlaps(m: Box) -> bool:
        return m.x < card.x + card.w and card.x < m.x + m.w and m.y < card.y + card.h and card.y < m.y + m.h

    if not overlaps(main):
        return main
    sw, sh = inp.width, inp.height
    fl, fr = (face.x - face.w) * sw, (face.x + face.w) * sw
    for x in (card.x + card.w, card.x - main.w):
        if 0 <= x <= sw - main.w and x <= fl and x + main.w >= fr:
            return Box(int(x), main.y, main.w, main.h)
    bottom = card.y
    top = max(0.0, face.y * sh - face.h * sh * 1.6)
    h = bottom - top
    if h < max(face.h * sh * 1.6, sh * 0.3):
        return main
    w = h * main.w / max(1, main.h)
    if w > sw:
        return main
    x = _clamp(face.x * sw - w / 2, 0, sw - w)
    return Box(int(round(x)), int(round(top)), _even(w), _even(h))


def _inset_box(face: _Face, inp: Inputs) -> Box:
    # Head and shoulders, not a face filling the box edge to edge.
    return _cell(face, 3 / 4, 0.36, inp)


def _clear_of_others(c: float, subject: _Face, others: list[_Face], window: float) -> float:
    """Shift a window centred at `c` so no other face is cut by its edge (director's
    sliver rule, for a held window): step off that face or take it in whole,
    whichever is the smaller move that keeps the subject well inside."""
    m = window * director.EDGE_MARGIN
    lo, hi = subject.left, subject.right
    for _ in range(3):
        moved = False
        for o in others:
            wl, wr = c - window / 2, c + window / 2
            if o.right <= wl or o.left >= wr or (o.left >= wl and o.right <= wr):
                continue
            pad = director.OTHER_MARGIN
            options = [o.left - pad - window / 2, o.right + pad + window / 2,
                       o.right + pad - window / 2, o.left - pad + window / 2]
            ok = [x for x in options if x - window / 2 >= -1e-9 and x + window / 2 <= 1 + 1e-9
                  and lo >= x - window / 2 + m / 2 and hi <= x + window / 2 - m / 2]
            if ok:
                c = min(ok, key=lambda x: abs(x - c))
                moved = True
        if not moved:
            break
    return c


#: A face narrower than this (share of the source width) is mush in the bubble.
PIP_MIN_FACE_W = 0.03


def _pip(inp: Inputs, a: int, b: int, faces: list[_Face], wide: bool, *,
         use_turns: bool, zoom: float) -> Shot:
    talk = _talk_time(inp.turns, a, b)
    order = _prominent(faces)
    sw = inp.width
    fw, _ = full_window(inp.width, inp.height, inp.out_w, inp.out_h)
    lo, hi = min(f.left for f in faces), max(f.right for f in faces)
    if len(order) >= 2 and not director._fits(lo, hi, fw / sw):
        main_face = max(order, key=lambda f: (talk.get(f.id, 0), f.w * f.presence))
        other = next(f for f in order if f.id != main_face.id)
        shot = _fill(inp, a, b, [main_face], use_turns=use_turns, zoom=zoom,
                     why="picture-in-picture: the speaker, with the other person inset")
        # The main picture holds on the speaker for the whole shot; following
        # turns would put the inset's face in the main picture too.
        if other.w < PIP_MIN_FACE_W:
            shot.why = "picture-in-picture: the other face is too small to read; following the speaker"
            return shot
        cx = _clear_of_others(main_face.x, main_face, [f for f in order if f.id != main_face.id], shot.window.w / sw)
        x = int(_clamp(round(cx * sw - shot.window.w / 2), 0, sw - shot.window.w))
        shot.window.x, shot.pan = x, [(a, x)]
        shot.kind, shot.inset, shot.base = "pip", _inset_box(other, inp), "fill"
        # The bubble sits on the right unless the speaker's face is there.
        rel = (main_face.x * sw - x) / max(1, shot.window.w)
        shot.side = "left" if rel > 0.55 else "right"
        return shot
    if len(order) == 1 and order[0].w < SMALL_FACE_W * 1.4 and wide:
        return Shot(a, b, "pip", base="fit", inset=_inset_box(order[0], inp),
                    why="picture-in-picture: the whole picture, with the face inset")
    return _fill(inp, a, b, faces, use_turns=use_turns, zoom=zoom,
                 why="picture-in-picture needs a second face; following the speaker")


# ------------------------------------------------------------------ groups

#: Two people are stacked or gridded only when the smaller face is at least
#: this share of the larger one's width (a close-up beside a speck in the
#: background is one subject, not a pair) and both are in most of the shot.
COMPARABLE_W = 0.4
COMPARABLE_PRESENCE = 0.5


def _comparable(faces: list[_Face], inp: Inputs) -> list[_Face]:
    """The people a split or a grid can show well: similar in size, there for
    most of the shot, and big enough that their cell is not blown into mush."""
    order = _prominent(faces)
    if not order:
        return []
    top = max(f.w for f in order)
    cell_w = inp.out_w if inp.out_h >= inp.out_w else inp.out_w / 2
    keep = []
    for f in order:
        if f.presence < COMPARABLE_PRESENCE or f.w < COMPARABLE_W * top:
            continue
        if cell_w / max(1.0, f.w * inp.width / 0.20) > MAX_CELL_UPSCALE * 1.25:
            continue
        keep.append(f)
    return keep


def _pair_fits(pair: list[_Face], share: float) -> bool:
    return director._fits(min(f.left for f in pair), max(f.right for f in pair), share)


#: A group window is used only when the busiest stretch holds this many times
#: its fair share of the people and movement; otherwise the group is spread
#: across the picture and it is shown whole.
GROUP_LEAD = 1.3


def _group_fill(inp: Inputs, a: int, b: int, faces: list[_Face], bodies: list[_Face], share: float) -> "Shot | None":
    """A wide group shot framed on where the people and the movement are,
    instead of the whole picture as a small card in the middle of a blur."""
    n = 64
    score = [0.0] * n

    def spread(left: float, right: float, weight: float) -> None:
        i0, i1 = max(0, int(left * n)), min(n - 1, int(right * n))
        if i1 < i0:
            return
        each = weight / (i1 - i0 + 1)
        for i in range(i0, i1 + 1):
            score[i] += each

    for bd in bodies:
        spread(bd.left, bd.right, bd.w * bd.h * bd.presence * 4)
    for f in faces:
        spread(f.left, f.right, f.w * f.presence * 2)
    act = _activity_profile(inp, a, b)
    if act is not None:
        cols = act[0]
        k = len(cols)
        total_cols = sum(cols) or 1.0
        people = sum(score) or 1.0
        for i in range(n):
            score[i] += 0.6 * people * cols[min(k - 1, int(i * k / n))] / total_cols
    total = sum(score)
    if total <= 0:
        return None
    span = max(1, min(n, round(share * n)))
    best, at = -1.0, 0
    for i in range(0, n - span + 1):
        s = sum(score[i:i + span])
        if s > best:
            best, at = s, i
    if (best / total) / (span / n) < GROUP_LEAD:
        return None
    centre = (at + span / 2) / n
    # Never slice someone at the edge: step off them or take them in.
    people = bodies or faces
    window = share
    for _ in range(3):
        moved = False
        for p in people:
            wl, wr = centre - window / 2, centre + window / 2
            if p.right <= wl or p.left >= wr or (p.left >= wl and p.right <= wr):
                continue
            options = [p.left - 0.005 - window / 2, p.right + 0.005 + window / 2,
                       p.right + 0.005 - window / 2, p.left - 0.005 + window / 2]
            options = [o for o in options if window / 2 <= o <= 1 - window / 2 and abs(o - centre) <= 0.12]
            if options:
                centre = min(options, key=lambda o: abs(o - centre))
                moved = True
        if not moved:
            break
    return _fill_centred(inp, a, b, centre, "a wide group: framed on where the people and the action are")


# ------------------------------------------------------------------ zoom moments

def _line_ends(inp: Inputs) -> list[int]:
    """Where sentences end, in source ms. Punch-ins change only on these."""
    out = []
    for w in inp.words or []:
        text = str(w.get("text", "")).strip()
        if text.endswith((".", "?", "!")):
            out.append(int(w.get("end_ms", 0)) + inp.in_ms)
    return out


def _moments(a: int, b: int, ends: list[int]) -> list[tuple[int, int]]:
    """A long shot cut into lines of at least PUNCH_MIN_MS, at sentence ends."""
    spans: list[tuple[int, int]] = []
    cursor = a
    for e in ends:
        if e - cursor >= PUNCH_MIN_MS and b - e >= PUNCH_MIN_MS:
            spans.append((cursor, e))
            cursor = e
    spans.append((cursor, b))
    return spans


# ------------------------------------------------------------------ the plan

def plan(inp: Inputs) -> list[Shot]:
    """The shot list for one clip, in source time, covering in_ms..out_ms exactly."""
    from . import frame as framing

    layout = inp.layout if inp.layout in LAYOUTS else "auto"
    start, end = inp.in_ms, inp.out_ms
    if end <= start:
        return []
    if layout in {"streamer", "black-box", "title-subtitles"}:
        kind = {"streamer": "fit", "black-box": "bars", "title-subtitles": "headline"}[layout]
        return [Shot(start, end, kind, why=f"{layout}: every shot shown whole")]

    use_turns = inp.focus not in WANTS_EVERYONE
    track = inp.track

    # A composite (two feeds side by side) is decided as a whole: its join
    # runs through every shot.
    if track is not None and layout in {"auto", "split"} and framing.seam_of(track) is not None:
        chosen = framing.plan(track, inp.tracks, inp.turns, inp.out_w, inp.out_h,
                              inp.focus, inp.cuts)
        if chosen["layout"] == "one-feed" and chosen.get("feed"):
            f = chosen["feed"]
            return [Shot(start, end, "feed", main=Box(f["x"], f["y"], f["w"], f["h"]),
                         why="a composite carried by one side")]
        if chosen["cells"]:
            cells = [Box(c["x"], c["y"], c["w"], c["h"]) for c in chosen["cells"]]
            return [Shot(start, end, "split", cells=cells, why="a composite: one cell per feed")]

    # With no analysis at all (no detector on this host), the old tracker's
    # motion samples still aim the crop at whatever is moving. With detail
    # profiles the shot loop below decides, faces or no faces.
    if not inp.tracks and not inp.detail:
        if track is not None and getattr(track, "samples", None) and layout in {"auto", "full-video", "split", "grid", "screen", "pip"}:
            sw, sh = inp.width, inp.height
            ww, wh = full_window(sw, sh, inp.out_w, inp.out_h)
            pan = [(ms, int(_clamp(round(c * sw - ww / 2), 0, sw - ww)))
                   for ms, c in track.samples if start <= ms < end] or \
                  [(start, int(_clamp(round(track.samples[0][1] * sw - ww / 2), 0, sw - ww)))]
            if pan[0][0] != start:
                pan.insert(0, (start, pan[0][1]))
            return [Shot(start, end, "fill", window=Box(pan[0][1], (sh - wh) // 2, ww, wh),
                         pan=pan, why="no faces found: following movement")]

    fw, _ = full_window(inp.width, inp.height, inp.out_w, inp.out_h)
    share = fw / max(1, inp.width)
    ends = _line_ends(inp) if inp.zoom == "moments" else []
    out: list[Shot] = []
    for a, b, card in _with_cards(inp, _split_on_presence(inp, director.shots(inp.cuts, start, end)), layout):
        cast = director.people_in(inp.tracks, a, b)
        bodies = _bodies_in(inp, a, b)
        faces = _real_faces(_faces(cast), bodies, inp)
        texts = _texts_in(inp, a, b)
        if card is not None and faces:
            out.append(_graphic(inp, a, b, faces, card))
            continue
        if _is_title(_titles_in(inp, a, b)) and layout in {"auto", "full-video", "screen", "pip", "split", "grid"}:
            # "DAY 1" across the picture: a title card is read whole or not at all.
            out.append(Shot(a, b, "fit", why="a title on screen: shown whole"))
            continue
        wide, centre = _detail(inp, a, b, share)
        if not faces:
            if bodies and layout in {"auto", "full-video", "screen", "pip", "split", "grid"}:
                shot = _fill_body(inp, a, b, bodies, "a person with no face to read: framed on their body")
                out.append(_clear_of_text(shot, texts, inp, *_body_span(bodies, shot, inp)))
                continue
            act = _activity_profile(inp, a, b)
            bright = _brightness(inp, a, b)
            still = (act is None or act[1] < STILL_SCREEN_MOTION) and (bright is None or bright >= DARK_PICTURE)
            if _detail_lead(inp, a, b, share) < FACELESS_LEAD:
                centre = 0.5            # detail all over: the middle is what was filmed
            zoom_box = _activity_zoom(inp, a, b, centre) if wide and still and layout in {"auto", "screen", "pip", "split", "grid"} else None
            if zoom_box is not None:
                # Screen + zoom: the whole picture on top for context, a close-up of
                # where the content is below, so a screen recording reads on a phone.
                out.append(Shot(a, b, "screen", main=zoom_box,
                                why="nobody in shot: the whole screen, with a close-up of the busy part"))
            elif layout in {"auto", "screen", "pip", "split", "grid"} and wide and still:
                out.append(Shot(a, b, "fit", why="nobody in shot and the picture runs edge to edge: shown whole"))
            else:
                where = _activity_centre(inp, a, b, share) if act is not None else None
                if where is not None and where[1] >= ACTIVITY_LEAD:
                    pan = _activity_pan(inp, a, b, share)
                    shot = _fill_centred(inp, a, b, where[0], "nobody in shot: framed on the action")
                    if len(pan) > 1 and max(c for _, c in pan) - min(c for _, c in pan) > 0.06:
                        sw = inp.width
                        ww = shot.window.w
                        shot.pan = [(a, int(_clamp(round(pan[0][1] * sw - ww / 2), 0, sw - ww)))] + \
                                   [(ms, int(_clamp(round(c * sw - ww / 2), 0, sw - ww))) for ms, c in pan[1:]]
                        shot.window.x = shot.pan[0][1]
                        shot.why = "nobody in shot: following the action"
                    out.append(_clear_of_text(shot, texts, inp, where[0] - 0.05, where[0] + 0.05))
                else:
                    out.append(_clear_of_text(_faceless_fill(inp, a, b, centre, share, out), texts, inp, 0.45, 0.55))
            continue

        lo, hi = min(f.left for f in faces), max(f.right for f in faces)
        fits = director._fits(lo, hi, share)
        talk = _talk_time(inp.turns, a, b)
        talkers = [tid for tid, ms in talk.items() if ms >= BOTH_TALK_MS]
        # With nobody named as the speaker there is no one to follow, and a
        # crop on the "most prominent" face is a coin toss: show both.
        unnamed = not talk
        zoom = _auto_zoom(faces, inp, share, bodies) if inp.zoom in {"auto", "moments"} else 1.0
        # A webcam over a screen: a small, readable face in a corner of a flat
        # picture that holds still. White walls are flat too, so a room where
        # people move about (or a dark one) is not a screen share.
        act = _activity_profile(inp, a, b)
        bright = _brightness(inp, a, b)
        still_picture = (act is None or act[1] < STILL_SCREEN_MOTION) and (bright is None or bright >= DARK_PICTURE)
        small_inset = (len(faces) == 1 and SPEAKER_MIN_W <= faces[0].w < SMALL_FACE_W and wide
                       and _in_corner(faces[0]) and still_picture and not bodies_beyond(faces[0], bodies))

        comparable = _comparable(faces, inp)
        pair = comparable[:2]
        pair_apart = len(pair) == 2 and not _pair_fits(pair, share)
        speaker = max(_prominent(faces), key=lambda f: (talk.get(f.id, 0), f.w * f.presence))

        if layout == "screen":
            if not small_inset and (speaker.w >= CLOSE_UP_W or speaker.w < SPEAKER_MIN_W):
                pass                            # the person is the picture, or a speck: following the speaker below
            else:
                out.append(_screen(inp, a, b, faces, "the picture on top, the speaker below"))
                continue
        if layout == "pip":
            out.append(_pip(inp, a, b, faces, wide, use_turns=use_turns, zoom=zoom))
            continue
        if layout == "grid" and len(comparable) >= 3:
            out.append(_grid(inp, a, b, comparable, "a group: one cell each"))
            continue
        if layout in {"split", "grid"} and pair_apart:
            out.append(_split(inp, a, b, pair, "two people sharing the shot: one cell each"))
            continue
        if (layout == "auto" and len(faces) >= 3 and not fits and _too_small_to_split(faces, inp)
                and (len(faces) >= 4 or not talk)):
            # A stage of small people: cells would blow faces up into mush. Frame
            # where the group and the movement are; if they are spread right
            # across the picture, show it whole.
            group = _group_fill(inp, a, b, faces, bodies, share)
            if group is not None:
                out.append(_clear_of_text(group, texts, inp, 0.45, 0.55))
            else:
                out.append(Shot(a, b, "fit", why="a wide group spread across the picture: shown whole"))
            continue
        if layout == "auto":
            if len(faces) >= 2 and not fits:
                if len(comparable) >= 3 and inp.focus == "everyone":
                    out.append(_grid(inp, a, b, comparable, "the whole group, as the clip is about all of them"))
                    continue
                if pair_apart and (inp.focus in WANTS_EVERYONE or len(talkers) >= 2 or unnamed):
                    out.append(_split(inp, a, b, pair,
                                      "both people matter in this shot: one cell each"))
                    continue
            if small_inset:
                out.append(_screen(inp, a, b, faces, "a small face over a wide picture: a screen share"))
                continue

        why = ("one person: framed on them" if len(faces) == 1 else
               "everyone fits: framed together" if fits else "following whoever is talking")
        spans = _moments(a, b, ends) if ends and b - a >= PUNCH_SHOT_MS else [(a, b)]
        cap = _zoom_cap(inp)
        carrier = _body_track(faces[0], inp, a, b) if len(faces) == 1 and faces[0].w < TRUSTED_FACE_W else None
        for i, (sa, sb) in enumerate(spans):
            z = zoom
            if len(spans) > 1 and i % 2 == 1:
                z = min(max(zoom, 1.0) * PUNCH, cap * 1.15)
            shot = _fill(inp, sa, sb, faces, use_turns=use_turns, zoom=z, tracks=[carrier] if carrier else None,
                         why=why + (" (punch-in on the line)" if z > zoom else "")
                         + (f", pushed in {z:.2f}x" if z > 1 and z == zoom else ""))
            out.append(_clear_of_text(shot, texts, inp, lo, hi) if fits else _clear_of_text(shot, texts, inp, *_subject_span(faces, shot, inp)))
    return _into_active(_merge(_steady(out)), inp)


def active_box(inp: Inputs) -> "Box | None":
    """The picture inside the source's black bars, in source px, or None."""
    if not inp.active:
        return None
    x0, y0, x1, y1 = inp.active
    sw, sh = inp.width, inp.height
    return Box(int(x0 * sw), int(y0 * sh), _even((x1 - x0) * sw), _even((y1 - y0) * sh))


def _inside(box: Box, area: Box) -> Box:
    """`box` shrunk about its centre (same shape) until it fits `area`, then moved into it."""
    k = min(1.0, area.w / max(1, box.w), area.h / max(1, box.h))
    w, h = _even(box.w * k), _even(box.h * k)
    cx, cy = box.x + box.w / 2, box.y + box.h / 2
    x = int(_clamp(round(cx - w / 2), area.x, area.x + area.w - w))
    y = int(_clamp(round(cy - h / 2), area.y, area.y + area.h - h))
    return Box(x, y, w, h)


def _into_active(shots_: list[Shot], inp: Inputs) -> list[Shot]:
    """Every crop kept inside the real picture: no letterbox or pillarbox bars in any shot."""
    area = active_box(inp)
    if area is None:
        return shots_
    for s in shots_:
        if s.window is not None:
            before = s.window
            win = _inside(before, area)
            if win.w != before.w:
                s.zoom = round(s.zoom * before.w / max(1, win.w), 3)
                s.why += ", inside the picture's black bars"
            shift = win.x - before.x
            s.pan = [(ms, int(_clamp(x + shift + (before.w - win.w) // 2, area.x, area.x + area.w - win.w)))
                     for ms, x in (s.pan or [(s.start_ms, before.x)])]
            win.x = s.pan[0][1]
            s.window = win
        s.cells = [_inside(c, area) for c in s.cells]
        if s.main is not None:
            s.main = _inside(s.main, area)
        if s.inset is not None and s.kind != "graphic":
            s.inset = _inside(s.inset, area)
        if s.kind == "screen" and not s.cells:
            s.cells = [area]
    return shots_


def _subject_span(faces: list[_Face], shot: Shot, inp: Inputs) -> tuple[float, float]:
    """The face the window is on (the one nearest its centre): its left and right edge."""
    if shot.window is None or not faces:
        return 0.45, 0.55
    c = (shot.window.x + shot.window.w / 2) / inp.width
    f = min(faces, key=lambda f: abs(f.x - c))
    return f.left, f.right


def _body_span(bodies: list[_Face], shot: Shot, inp: Inputs) -> tuple[float, float]:
    if shot.window is None or not bodies:
        return 0.45, 0.55
    c = (shot.window.x + shot.window.w / 2) / inp.width
    f = min(bodies, key=lambda f: abs(f.x - c))
    return f.left, f.right


#: A faceless stretch keeps one look unless a shot of another look lasts this long.
STEADY_MS = 2000
#: A shot this short between two faceless shots is a blip (a thumb read as a face).
BLIP_MS = 1000


def _faceless(s: Shot) -> bool:
    return s.why.startswith("nobody in shot")


def _steady(shots_: list[Shot]) -> list[Shot]:
    """Stop a faceless stretch flipping between looks.

    Handheld close-ups (a hand drawing, a product turned in the hand) cut
    often and their detail moves, so shot by shot the plan flipped between a
    crop and the screen + close-up look every half second, and a thumb read
    as a face for 0.7 s cut to a close-up of the thumb. A short shot inside a
    faceless stretch keeps the framing before it.
    """
    out: list[Shot] = []
    for i, s in enumerate(shots_):
        prev = out[-1] if out else None
        nxt = shots_[i + 1] if i + 1 < len(shots_) else None
        if prev is not None and _faceless(prev) and prev.kind in {"fill", "screen", "fit"}:
            blip = (not _faceless(s) and s.length_ms < BLIP_MS and s.kind == "fill"
                    and nxt is not None and _faceless(nxt))
            flip = _faceless(s) and s.kind != prev.kind and s.length_ms < STEADY_MS
            if blip or flip:
                out.append(Shot(s.start_ms, s.end_ms, prev.kind, window=prev.window,
                                pan=[(s.start_ms, prev.pan[-1][1])] if prev.pan else [],
                                main=prev.main, zoom=prev.zoom,
                                why=prev.why if _faceless(prev) else s.why))
                continue
        out.append(s)
    return out


def caption_y(shot: Shot, inp: Inputs) -> "float | None":
    """Where captions sit for this composition (centre, 0 top .. 1 bottom), or None for the default.

    Two cards: on the seam between them, the usual short-form place, clear of
    both faces (the default middle sat on the lower person's head). A person
    over an on-screen card: over their chest, just above the card. Mirrored by
    captionYFor in lib/clip-looks for the preview and the browser render.
    """
    from . import looks

    w, h = inp.out_w, inp.out_h
    if h < w or not h:
        return None
    if shot.kind == "split":
        return 0.5
    if shot.kind == "screen" and shot.main is not None:
        top, _ = screen_split(inp)
        return top / h
    if shot.kind == "graphic" and shot.inset is not None:
        (_, py, _, ph), _ = looks.graphic_cards(w, h, shot.inset.w, shot.inset.h)
        return (py + ph) / h - 0.06
    return None


def _merge(shots_: list[Shot]) -> list[Shot]:
    """Neighbouring shots that would look the same render as one."""
    out: list[Shot] = []
    for s in shots_:
        if out and s.kind in {"fit", "bars", "headline"} and out[-1].kind == s.kind:
            out[-1].end_ms = s.end_ms
            continue
        out.append(s)
    return out


def summary(shots_: list[Shot]) -> dict[str, int]:
    """How much of the clip each kind of shot takes, in ms."""
    held: dict[str, int] = {}
    for s in shots_:
        held[s.kind] = held.get(s.kind, 0) + s.length_ms
    return held
