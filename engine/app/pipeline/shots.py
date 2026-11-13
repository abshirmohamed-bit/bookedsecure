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
    """How far this source can be pushed in before the picture goes soft."""
    _, fh = full_window(inp.width, inp.height, inp.out_w, inp.out_h)
    base = inp.out_h / max(1, fh)          # enlargement the output already needs
    return _clamp(MAX_UPSCALE / base, MIN_CAP, MAX_CAP)


def _auto_zoom(faces: list[_Face], inp: Inputs, share: float) -> float:
    """Push in on a wide shot until the subject reads, never past the cap.

    When everyone in the shot fits the window, the push stops while they
    still all fit: a wide two-shot should get tighter, not lose a person.
    """
    if not faces:
        return 1.0
    subject = max(faces, key=lambda f: f.h)
    want = TARGET_FACE_H / max(subject.h, 1e-3)
    lo, hi = min(f.left for f in faces), max(f.right for f in faces)
    if director._fits(lo, hi, share):
        want = min(want, share * (1 - 2 * director.EDGE_MARGIN) / max(hi - lo, 1e-3))
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


# ------------------------------------------------------------------ shot kinds

def _fill(inp: Inputs, a: int, b: int, faces: list[_Face], *, use_turns: bool,
          zoom: float, why: str) -> Shot:
    sw, sh = inp.width, inp.height
    fw, fh = full_window(sw, sh, inp.out_w, inp.out_h)
    ww, wh = _even(fw / zoom), _even(fh / zoom)
    limit = _subtitle_limit(inp)
    if limit is not None and wh > limit:
        # Push in just enough that the crop ends above the burned-in subtitles.
        zoom *= wh / limit
        ww, wh = _even(fw / zoom), _even(fh / zoom)
    share = ww / sw
    if faces:
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
    return _fill_centred(inp, a, b, aim, why)


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
MIN_PIECE_MS = 700


def screen_split(inp: Inputs) -> tuple[int, int]:
    """(picture height, person height) for the screen layout, in output px."""
    top = _even(inp.out_w * inp.height / max(1, inp.width))
    top = min(top, _even(inp.out_h * 0.5))
    return top, inp.out_h - top


def _screen(inp: Inputs, a: int, b: int, faces: list[_Face], why: str) -> Shot:
    talk = _talk_time(inp.turns, a, b)
    order = _prominent(faces)
    subject = max(order, key=lambda f: (talk.get(f.id, 0), f.w * f.presence))
    _, bottom = screen_split(inp)
    aspect = inp.out_w / max(2, bottom)
    main = _cell(subject, aspect, 0.30, inp)
    return Shot(a, b, "screen", main=main, why=why)


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
        cx = _clear_of_others(main_face.x, main_face, [f for f in order if f.id != main_face.id], shot.window.w / sw)
        x = int(_clamp(round(cx * sw - shot.window.w / 2), 0, sw - shot.window.w))
        shot.window.x, shot.pan = x, [(a, x)]
        shot.kind, shot.inset, shot.base = "pip", _inset_box(other, inp), "fill"
        return shot
    if len(order) == 1 and order[0].w < SMALL_FACE_W * 1.4 and wide:
        return Shot(a, b, "pip", base="fit", inset=_inset_box(order[0], inp),
                    why="picture-in-picture: the whole picture, with the face inset")
    return _fill(inp, a, b, faces, use_turns=use_turns, zoom=zoom,
                 why="picture-in-picture needs a second face; following the speaker")


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
        faces = _faces(cast)
        if card is not None and faces:
            out.append(_graphic(inp, a, b, faces, card))
            continue
        wide, centre = _detail(inp, a, b, share)
        if not faces:
            if _detail_lead(inp, a, b, share) < FACELESS_LEAD:
                centre = 0.5            # detail all over: the middle is what was filmed
            zoom_box = _activity_zoom(inp, a, b, centre) if wide and layout in {"auto", "screen", "pip", "split", "grid"} else None
            if zoom_box is not None:
                # Screen + zoom: the whole picture on top for context, a close-up of
                # where the content is below, so a screen recording reads on a phone.
                out.append(Shot(a, b, "screen", main=zoom_box,
                                why="nobody in shot: the whole screen, with a close-up of the busy part"))
            elif layout in {"auto", "screen", "pip", "split", "grid"} and wide:
                out.append(Shot(a, b, "fit", why="nobody in shot and the picture runs edge to edge: shown whole"))
            else:
                out.append(_faceless_fill(inp, a, b, centre, share, out))
            continue

        lo, hi = min(f.left for f in faces), max(f.right for f in faces)
        fits = director._fits(lo, hi, share)
        talk = _talk_time(inp.turns, a, b)
        talkers = [tid for tid, ms in talk.items() if ms >= BOTH_TALK_MS]
        # With nobody named as the speaker there is no one to follow, and a
        # crop on the "most prominent" face is a coin toss: show both.
        unnamed = not talk
        zoom = _auto_zoom(faces, inp, share) if inp.zoom in {"auto", "moments"} else 1.0
        small_inset = len(faces) == 1 and faces[0].w < SMALL_FACE_W and wide and _in_corner(faces[0])

        if layout == "screen":
            out.append(_screen(inp, a, b, faces, "the picture on top, the speaker below"))
            continue
        if layout == "pip":
            out.append(_pip(inp, a, b, faces, wide, use_turns=use_turns, zoom=zoom))
            continue
        if layout == "grid" and len(faces) >= 3:
            out.append(_grid(inp, a, b, faces, "a group: one cell each"))
            continue
        if layout in {"split", "grid"} and len(faces) >= 2 and not fits:
            out.append(_split(inp, a, b, faces, "two people sharing the shot: one cell each"))
            continue
        if (layout == "auto" and len(faces) >= 3 and not fits and _too_small_to_split(faces, inp)
                and (len(faces) >= 4 or not talk)):
            # A stage of tiny people: cells would blow two faces up into mush and
            # miss what the group is doing. Show the whole picture.
            out.append(Shot(a, b, "fit", why="a wide group shot, faces too small to split: shown whole"))
            continue
        if layout == "auto":
            if len(faces) >= 2 and not fits:
                if len(faces) >= 3 and inp.focus == "everyone":
                    out.append(_grid(inp, a, b, faces, "the whole group, as the clip is about all of them"))
                    continue
                if inp.focus in WANTS_EVERYONE or len(talkers) >= 2 or unnamed:
                    out.append(_split(inp, a, b, faces,
                                      "both people matter in this shot: one cell each"))
                    continue
            if small_inset:
                out.append(_screen(inp, a, b, faces, "a small face over a wide picture: a screen share"))
                continue

        why = ("one person: framed on them" if len(faces) == 1 else
               "everyone fits: framed together" if fits else "following whoever is talking")
        spans = _moments(a, b, ends) if ends and b - a >= PUNCH_SHOT_MS else [(a, b)]
        cap = _zoom_cap(inp)
        for i, (sa, sb) in enumerate(spans):
            z = zoom
            if len(spans) > 1 and i % 2 == 1:
                z = min(max(zoom, 1.0) * PUNCH, cap * 1.15)
            out.append(_fill(inp, sa, sb, faces, use_turns=use_turns, zoom=z,
                             why=why + (" (punch-in on the line)" if z > zoom else "")
                             + (f", pushed in {z:.2f}x" if z > 1 and z == zoom else "")))
    return _merge(_steady(out))


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
