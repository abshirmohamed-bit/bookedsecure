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
#: Per range: (ms, [text boxes]) from subjects.detect_text, the same frames as the cards.
_TEXT: "OrderedDict[tuple, list]" = OrderedDict()
#: Text has to hold still this long to count as something the crop must respect.
TEXT_MIN_MS = 900
#: A "text" box covering this much of the frame, or this tall, is the detector
#: misreading a busy picture; real titles stay well under it.
TEXT_MAX_AREA = 0.35
TEXT_MAX_H = 0.5
#: Subtitles live in the bottom of the picture, below this share of its height.
SUB_ZONE = 0.74
#: Burned-in subtitles count when seen in at least this share of the frames.
SUB_SHARE = 0.5
#: Ranges kept: a job's styling stage reads every clip (up to 60), and the
#: exports that follow should find each one here rather than read it again.
CACHE_MAX = 64


def _cards_in(frame, text: list | None = None) -> list[tuple[float, float, float, float]]:
    """Card boxes in one BGR frame, as (x, y, w, h) shares of the frame.

    With the text detector's boxes for the frame, a card has to have words on
    it: a white balustrade, a lit wall or a fridge door passed the colour and
    shape tests and had the person laid over "a card" of nothing.
    """
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
        x, y, bw, bh = _solid_core(light, *cv2.boundingRect(c))
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
        dark = float((inner < 120).mean())
        if not (MIN_TEXT <= dark <= MAX_TEXT):
            continue
        box = (x / w, y / h, bw / w, bh / h)
        if text is not None and not any(_inside(t, box) for t in text):
            continue
        out.append(box)
    return out


def _inside(t, box, slack: float = 0.02) -> bool:
    """Whether a text box sits (mostly) within a card box."""
    return (t[0] >= box[0] - slack and t[1] >= box[1] - slack
            and t[0] + t[2] <= box[0] + box[2] + slack and t[1] + t[3] <= box[1] + box[3] + slack)


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


def _solid_core(mask, x: int, y: int, w: int, h: int) -> tuple[int, int, int, int]:
    """The box trimmed to the rows and columns that are mostly card.

    White text just beside a card (a channel label, a lower third) can join it
    after the text-closing step, widening the box so a sliver of the label
    ("Interna…") was shown with the card.
    """
    import numpy as np

    roi = mask[y:y + h, x:x + w] > 0
    if roi.size == 0:
        return x, y, w, h

    def run(fill) -> tuple[int, int]:
        good = fill >= 0.6
        best, start, at = (0, 0), None, 0
        for i, g in enumerate(list(good) + [False]):
            if g and start is None:
                start = i
            elif not g and start is not None:
                if i - start > best[1] - best[0]:
                    best = (start, i)
                start = None
            at = i
        return best if best[1] > best[0] else (0, len(fill))

    c0, c1 = run(roi.mean(axis=0))
    r0, r1 = run(roi[:, c0:c1].mean(axis=1))
    return x + c0, y + r0, c1 - c0, r1 - r0


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
    from . import subjects

    read_text = subjects.text_available()
    out = []
    subs = []
    texts = []
    for i in range(len(raw) // size):
        frame = np.frombuffer(raw[i * size:(i + 1) * size], np.uint8).reshape(h, WIDTH, 3)
        ms = in_ms + int(i * 1000 / RATE)
        words = subjects.detect_text(frame) if read_text else None
        found = _cards_in(frame, words)
        out.append((ms, found))
        subs.append(_subtitle_top(frame, found))
        texts.append((ms, words or []))
    if key is not None:
        _SUBS[key] = subs
        while len(_SUBS) > CACHE_MAX:
            _SUBS.popitem(last=False)
        _TEXT[key] = texts
        while len(_TEXT) > CACHE_MAX:
            _TEXT.popitem(last=False)
        _CACHE[key] = out
        while len(_CACHE) > CACHE_MAX:
            _CACHE.popitem(last=False)
    return out


#: A row or column this dark and this even, all the way across, is a bar
#: someone added (letterbox, pillarbox), not picture.
BAR_LEVEL = 20
BAR_SPREAD = 8
#: Bars thinner than this share are ignored; they must be found in most frames.
BAR_MIN = 0.03
BAR_SHARE = 0.7
_BARS: "OrderedDict[tuple, tuple | None]" = OrderedDict()


def _bars_in(grey) -> tuple[float, float, float, float]:
    """(top, bottom, left, right) bar thickness in one grey frame, shares of its size."""
    import numpy as np

    h, w = grey.shape
    rows = (grey.mean(axis=1) < BAR_LEVEL) & (grey.std(axis=1) < BAR_SPREAD)
    cols = (grey.mean(axis=0) < BAR_LEVEL) & (grey.std(axis=0) < BAR_SPREAD)

    def run(mask) -> int:
        n = 0
        for v in mask:
            if not v:
                break
            n += 1
        return n

    return run(rows) / h, run(rows[::-1]) / h, run(cols) / w, run(cols[::-1]) / w


#: Added bars come in pairs of near-equal size (a letterbox top and bottom, a
#: pillarbox left and right); one side's dark edge is the scene.
BAR_PAIR_TOLERANCE = 0.03


def paired(top: float, bottom: float, left: float, right: float) -> tuple[float, float, float, float]:
    """Keep only bars that come as a matching pair.

    A studio lit against black has a dark band on one side (and often along
    the top) in every frame, which reads like a bar; real added bars are
    symmetric. Seen on an interview series: the black studio right of the
    guest was taken for a pillarbox and every crop was kept out of it.
    """
    if not (top and bottom and abs(top - bottom) <= BAR_PAIR_TOLERANCE):
        top = bottom = 0.0
    if not (left and right and abs(left - right) <= BAR_PAIR_TOLERANCE):
        left = right = 0.0
    return top, bottom, left, right


def letterbox(video: Path, in_ms: int, out_ms: int, samples: int = 9) -> "tuple[float, float, float, float] | None":
    """The real picture inside added black bars, as (x0, y0, x1, y1) shares, or None without bars.

    A cinematic film letterboxed into 16:9, or a phone video pillarboxed into
    it: the bars are not picture, so no crop should show them and no card
    should frame them. Read from a few small frames across the range; a dark
    scene is not a bar because the bar has to be there in most of them.
    """
    import numpy as np

    try:
        st = video.stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms)
    except OSError:
        return None
    if key in _BARS:
        return _BARS[key]
    from .. import media

    length = max(1, out_ms - in_ms)
    found = []
    for k in range(samples):
        at = in_ms + int(length * (k + 0.5) / samples)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at / 1000:.3f}", "-i", str(video), "-frames:v", "1",
                              "-vf", "scale=320:180,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        if len(raw) >= 320 * 180:
            found.append(_bars_in(np.frombuffer(raw[:320 * 180], np.uint8).reshape(180, 320).astype("float32")))
    result = None
    if found:
        sides = []
        for i in range(4):
            vals = sorted(f[i] for f in found)
            kept = [v for v in vals if v >= BAR_MIN]
            sides.append(min(kept) if len(kept) >= BAR_SHARE * len(found) else 0.0)
        top, bottom, left, right = paired(*sides)
        if any(v > 0 for v in (top, bottom, left, right)) and top + bottom < 0.6 and left + right < 0.8:
            result = (round(left + 0.004, 4), round(top + 0.004, 4), round(1 - right - 0.004, 4), round(1 - bottom - 0.004, 4))
    _BARS[key] = result
    while len(_BARS) > CACHE_MAX:
        _BARS.popitem(last=False)
    return result


def text_boxes(video: Path, in_ms: int, out_ms: int) -> list[tuple[int, list]]:
    """(ms, [text boxes as shares]) every 1/RATE s over the range: labels, titles, burned-in captions."""
    try:
        st = video.stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms)
    except OSError:
        return []
    if key not in _TEXT:
        sightings(video, in_ms, out_ms)
    return list(_TEXT.get(key, []))


def text_spans(seen: list[tuple[int, list]], start_ms: int, end_ms: int, *, min_ms: int = TEXT_MIN_MS,
               ) -> list[tuple[float, float, float, float]]:
    """The text boxes that hold still through [start, end): a label, a title, a caption line."""
    return [r[0] for r in text_runs(seen, start_ms, end_ms, min_ms=min_ms)]


#: Text must be read in at least this many frames in a row: shelving, wall
#: art and window bars pass the detector for a frame or two as the camera moves.
TEXT_MIN_SIGHTINGS = 3


def text_runs(seen: list[tuple[int, list]], start_ms: int, end_ms: int, *, min_ms: int = TEXT_MIN_MS,
              ) -> list[tuple[tuple[float, float, float, float], int]]:
    """(box, how long it held in ms) for each run of text that holds still through [start, end).

    Boxes seen in the same place in enough consecutive frames are merged (the
    union of their sightings); a flash of text in a frame or two is ignored.
    """
    step = int(1000 / RATE)
    runs: list[dict] = []
    for ms, boxes in seen:
        if not (start_ms <= ms < end_ms):
            continue
        for b in boxes:
            if b[2] * b[3] > TEXT_MAX_AREA or b[3] > TEXT_MAX_H:
                continue                    # the detector took the whole picture for text
            for r in runs:
                if _iou(r["box"], b) >= 0.4 and ms - r["last"] <= 2 * step:
                    r["box"] = (min(r["box"][0], b[0]), min(r["box"][1], b[1]),
                                max(r["box"][0] + r["box"][2], b[0] + b[2]) - min(r["box"][0], b[0]),
                                max(r["box"][1] + r["box"][3], b[1] + b[3]) - min(r["box"][1], b[1]))
                    r["last"] = ms
                    r["n"] += 1
                    break
            else:
                runs.append({"box": b, "first": ms, "last": ms, "n": 1})
    out = []
    for r in runs:
        held = r["last"] - r["first"] + step
        whole_shot = r["first"] - step <= start_ms and r["last"] + step >= end_ms
        steady = held >= min_ms and r["n"] >= TEXT_MIN_SIGHTINGS
        if steady or (whole_shot and (r["n"] >= 2 or end_ms - start_ms < 2 * step)):
            out.append((tuple(round(v, 4) for v in r["box"]), held))
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
            # Nearly the union (a card that slides in is shown whole), but one odd
            # sighting merged with a nearby label must not widen it.
            def lo(v):
                v = sorted(v)
                return v[len(v) // 5]

            def hi(v):
                v = sorted(v)
                return v[len(v) - 1 - len(v) // 5]

            box = (lo(xs), lo(ys), hi(x2) - lo(xs), hi(y2) - lo(ys))
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
