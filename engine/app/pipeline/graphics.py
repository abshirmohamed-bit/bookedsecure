"""On-screen cards: the tweet, the Facebook comment, the quote panel.

Broadcasts and explainers put the question being answered on screen as a
card: a bright rectangle full of text. A crop aimed at the person talking
slices it in half ("…you're doing up there"), which reads as broken. This
finds those cards so the shot plan can show the person on top and the card
whole below it (shots "graphic").

A card is a light, flat, rectangular region with dark text inside, wider
than it is tall, that holds still for a while. Lit walls and white
equipment fail the text test or the rectangle test; a whole bright frame
fails the size test.
"""
from __future__ import annotations

import subprocess
from collections import OrderedDict
from pathlib import Path

#: Frames read per second of the clip.
RATE = 2
#: Analysis width, px.
WIDTH = 640
#: A card covers this share of the frame, at least and at most.
MIN_AREA = 0.025
MAX_AREA = 0.5
MIN_WIDTH = 0.16
#: Width / height.
MIN_ASPECT, MAX_ASPECT = 1.15, 8.0
#: The contour fills this much of its bounding box.
MIN_SOLID = 0.8
#: Share of dark (text) pixels inside.
MIN_TEXT, MAX_TEXT = 0.012, 0.35
#: How alike two sightings must be (IoU) to be the same card.
SAME_CARD = 0.6

_CACHE: "OrderedDict[tuple, list]" = OrderedDict()
#: Per range: the top of burned-in subtitles in each frame read (share of height) or None.
_SUBS: "OrderedDict[tuple, list]" = OrderedDict()
#: Subtitles live in the bottom of the picture, below this share of its height.
SUB_ZONE = 0.74
#: Burned-in subtitles count when seen in at least this share of the frames.
SUB_SHARE = 0.5
CACHE_MAX = 16


def _cards_in(frame) -> list[tuple[float, float, float, float]]:
    """Card boxes in one BGR frame, as (x, y, w, h) shares of the frame."""
    import cv2
    import numpy as np

    h, w = frame.shape[:2]
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    light = ((hsv[..., 2] >= 212) & (hsv[..., 1] <= 40)).astype(np.uint8) * 255
    # Close over the text so a card is one solid region.
    light = cv2.morphologyEx(light, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # Thin white lines (a picture frame's border) would join a card and spoil its shape.
    light = cv2.morphologyEx(light, cv2.MORPH_OPEN, np.ones((11, 11), np.uint8))
    contours, _ = cv2.findContours(light, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    out = []
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        area = bw * bh / (w * h)
        if not (MIN_AREA <= area <= MAX_AREA) or bw < MIN_WIDTH * w:
            continue
        if not (MIN_ASPECT <= bw / max(1, bh) <= MAX_ASPECT):
            continue
        if cv2.contourArea(c) / max(1, bw * bh) < MIN_SOLID:
            continue
        # Touching three or four sides is the background, not a card.
        if sum([x <= 1, y <= 1, x + bw >= w - 1, y + bh >= h - 1]) >= 3:
            continue
        inner = gray[y + bh // 10: y + bh - bh // 10, x + bw // 20: x + bw - bw // 20]
        if inner.size == 0:
            continue
        text = float((inner < 120).mean())
        if not (MIN_TEXT <= text <= MAX_TEXT):
            continue
        out.append((x / w, y / h, bw / w, bh / h))
    return out


def _subtitle_top(frame, cards) -> "float | None":
    """The top of a line of burned-in subtitles near the bottom (share of height), if any.

    Subtitle text is bright, centred and edgy against a darker picture, in a
    few rows near the bottom. A card found there is a card, not subtitles.
    """
    import cv2
    import numpy as np

    h, w = frame.shape[:2]
    grey = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)[..., 1]
    y0 = int(h * SUB_ZONE)
    x0, x1 = int(w * 0.12), int(w * 0.88)
    zone = grey[y0:h - 2, x0:x1]
    # Subtitle text is white (or near it); app icons and products are colourful.
    bright = (zone >= 200) & (sat[y0:h - 2, x0:x1] <= 50)
    edges = np.abs(np.diff(zone.astype(np.int16), axis=1)) >= 60
    rows = (bright.mean(axis=1) >= 0.01) & (bright.mean(axis=1) <= 0.35) & (edges.mean(axis=1) >= 0.03)
    idx = np.flatnonzero(rows)
    if len(idx) < max(4, h // 60) or idx[0] <= 2:
        # (Text running in from above the zone is a picture crossing it, not a subtitle line.)
        return None
    # Above a subtitle line the picture is darker than the text (a dark scene, a
    # shadow or a box behind it); app labels on a bright phone screen are not.
    above = zone[max(0, idx[0] - 6):max(1, idx[0] - 2)]
    if above.size == 0 or float(above.mean()) > 120:
        return None
    # A subtitle line is centred: its text spreads evenly either side of the middle.
    cols = np.flatnonzero(bright[idx].any(axis=0))
    if len(cols) == 0:
        return None
    mid = (x1 - x0) / 2
    if abs((cols[0] + cols[-1]) / 2 - mid) > 0.06 * w:
        return None
    top = (y0 + idx[0]) / h
    for cx, cy, cw, ch in cards:
        if cy <= top <= cy + ch:
            return None
    return float(top)


def subtitle_top(video: Path, in_ms: int, out_ms: int) -> "float | None":
    """Where burned-in subtitles start (share of height), when the video has them, else None.

    Crops end above this so a cropped picture never shows half a subtitle
    line ("n accurate, spacio"); the Engine draws its own captions.
    """
    try:
        st = video.stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms)
    except OSError:
        return None
    if key not in _SUBS:
        sightings(video, in_ms, out_ms)
    tops = _SUBS.get(key, [])
    seen = sorted(t for t in tops if t is not None)
    if not tops or len(seen) < SUB_SHARE * len(tops):
        return None
    # The highest a line usually starts (two-line subtitles start higher).
    return seen[len(seen) // 10] - 0.01


def _iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw = max(0.0, min(ax2, bx2) - max(a[0], b[0]))
    ih = max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    return inter / max(1e-9, a[2] * a[3] + b[2] * b[3] - inter)


def sightings(video: Path, in_ms: int, out_ms: int) -> list[tuple[int, list]]:
    """(ms, [card boxes]) every 1/RATE s over the range, cached per source and range."""
    import numpy as np

    try:
        st = video.stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms)
    except OSError:
        key = None
    if key is not None and key in _CACHE:
        return _CACHE[key]
    from .. import media

    info = media.probe(video)
    h = int(round(WIDTH * info.height / max(1, info.width) / 2)) * 2
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{in_ms / 1000:.3f}", "-t", f"{max(0, out_ms - in_ms) / 1000:.3f}",
         "-i", str(video), "-vf", f"fps={RATE},scale={WIDTH}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
        capture_output=True, check=True).stdout
    size = WIDTH * h * 3
    out = []
    subs = []
    for i in range(len(raw) // size):
        frame = np.frombuffer(raw[i * size:(i + 1) * size], np.uint8).reshape(h, WIDTH, 3)
        found = _cards_in(frame)
        out.append((in_ms + int(i * 1000 / RATE), found))
        subs.append(_subtitle_top(frame, found))
    if key is not None:
        _SUBS[key] = subs
        while len(_SUBS) > CACHE_MAX:
            _SUBS.popitem(last=False)
        _CACHE[key] = out
        while len(_CACHE) > CACHE_MAX:
            _CACHE.popitem(last=False)
    return out


def spans(seen: list[tuple[int, list]], start_ms: int, end_ms: int, *, min_ms: int = 1500,
          ) -> list[tuple[int, int, tuple[float, float, float, float]]]:
    """Stretches of [start, end) where one card holds still: (from, to, box as shares).

    A card must be seen in a row for `min_ms`; the box is the union of its
    sightings, so a card that settles after sliding in is shown whole.
    """
    step = int(1000 / RATE)
    out = []
    run: list[tuple[int, tuple]] = []

    def close():
        if run and run[-1][0] - run[0][0] + step >= min_ms:
            xs = [b[0] for _, b in run]
            ys = [b[1] for _, b in run]
            x2 = [b[0] + b[2] for _, b in run]
            y2 = [b[1] + b[3] for _, b in run]
            box = (min(xs), min(ys), max(x2) - min(xs), max(y2) - min(ys))
            a = max(start_ms, run[0][0] - step // 2)
            b = min(end_ms, run[-1][0] + step // 2)
            if run[0][0] - step <= start_ms:
                a = start_ms
            if run[-1][0] + step >= end_ms:
                b = end_ms
            out.append((a, b, box))

    for ms, boxes in seen:
        if not (start_ms <= ms < end_ms):
            continue
        big = max(boxes, key=lambda b: b[2] * b[3]) if boxes else None
        if big is not None and (not run or _iou(run[-1][1], big) >= SAME_CARD):
            run.append((ms, big))
            continue
        close()
        run = [(ms, big)] if big is not None else []
    close()
    return out
