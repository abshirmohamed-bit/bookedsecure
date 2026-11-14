"""Broadcast panels: the boxes a multi-guest programme lays its people out in.

A panel debate, a news hit or a podcast "gallery" is one picture made of
several: each guest in a bordered box on a designed background, with the
programme's furniture round them (a ticker, "FOLLOW US", a logo). A crop that
follows a face knows none of that, so it showed one guest with slivers of the
boxes either side, the animated background and the ticker along the bottom.

The boxes hold still while what is inside them moves, which is how they are
found: edges that are there in almost every sampled frame are the borders,
and four of them that close a rectangle are a panel. No model, a few small
frames per clip, cached per source and range.

`detect` returns the panels as (x, y, w, h) shares of the frame, in reading
order, or [] when the picture is not a composite (fewer than two panels).
"""
from __future__ import annotations

import logging
import subprocess
from collections import OrderedDict
from pathlib import Path

log = logging.getLogger("engine.panels")

#: Frames read across the range, and the width they are read at.
SAMPLES = 12
WIDTH = 640
#: An edge pixel is a border when it is an edge in this share of the frames.
PERSIST = 0.75
#: Gradient (0-255 grey) that counts as an edge.
EDGE = 22
#: A panel covers this share of the frame, at least and at most.
MIN_AREA, MAX_AREA = 0.035, 0.6
#: Width / height of a panel.
MIN_ASPECT, MAX_ASPECT = 0.45, 2.4
#: Each side of a panel's box is a border along at least this much of it.
SIDE_COVER = 0.62
#: Two boxes this alike (IoU) are the same panel.
SAME = 0.6
#: A composite has at least this many panels.
MIN_PANELS = 2
CACHE_MAX = 64

_CACHE: "OrderedDict[tuple, list]" = OrderedDict()


def _iou(a, b) -> float:
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    x1, y1 = min(a[0] + a[2], b[0] + b[2]), min(a[1] + a[3], b[1] + b[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def _runs(mask_1d, min_len: int, gap: int = 3) -> list[tuple[int, int]]:
    """Stretches of True at least `min_len` long, bridging gaps of up to `gap`."""
    out: list[tuple[int, int]] = []
    start = None
    last = -10
    for i, v in enumerate(mask_1d):
        if v:
            if start is None:
                start = i
            elif i - last > gap + 1:
                if last - start + 1 >= min_len:
                    out.append((start, last + 1))
                start = i
            last = i
    if start is not None and last - start + 1 >= min_len:
        out.append((start, last + 1))
    return out


def from_frames(frames: list) -> list[tuple[float, float, float, float]]:
    """Panels in a set of grey frames of one size (numpy arrays), as shares of the frame."""
    import numpy as np

    if len(frames) < 4:
        return []
    h, w = frames[0].shape[:2]
    vert = np.zeros((h, w), np.float32)      # edges between columns: vertical borders
    horiz = np.zeros((h, w), np.float32)     # edges between rows: horizontal borders
    for f in frames:
        g = f.astype(np.float32)
        dx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
        dy = np.abs(np.diff(g, axis=0, prepend=g[:1, :]))
        vert += dx >= EDGE
        horiz += dy >= EDGE
    vert = vert / len(frames) >= PERSIST
    horiz = horiz / len(frames) >= PERSIST

    # Border lines: columns / rows where a persistent edge runs a long way.
    # A border is a pixel or two wide and may wobble by one, so neighbours count.
    def thick(m, axis):
        out = m.copy()
        if axis == 1:
            out[:, 1:] |= m[:, :-1]
            out[:, :-1] |= m[:, 1:]
        else:
            out[1:, :] |= m[:-1, :]
            out[:-1, :] |= m[1:, :]
        return out

    vert_t, horiz_t = thick(vert, 1), thick(horiz, 0)
    v_lines: list[tuple[int, int, int]] = []          # (x, y0, y1)
    for x in range(w):
        for y0, y1 in _runs(vert_t[:, x], int(h * 0.14)):
            v_lines.append((x, y0, y1))
    h_lines: list[tuple[int, int, int]] = []          # (y, x0, x1)
    for y in range(h):
        for x0, x1 in _runs(horiz_t[y, :], int(w * 0.08)):
            h_lines.append((y, x0, x1))
    if len(v_lines) < 2 or len(h_lines) < 2:
        return []

    # Merge lines a pixel or two apart into one (the two sides of a drawn border).
    def merge(lines):
        lines = sorted(lines)
        out = []
        for pos, a, b in lines:
            for o in out:
                if abs(o[0] - pos) <= 3 and a < o[2] and o[1] < b:
                    o[1], o[2] = min(o[1], a), max(o[2], b)
                    break
            else:
                out.append([pos, a, b])
        return out

    v_lines, h_lines = merge(v_lines), merge(h_lines)

    def cover_v(x: int, y0: int, y1: int) -> float:
        best = 0.0
        for dx in (-2, -1, 0, 1, 2):
            xx = x + dx
            if 0 <= xx < w:
                best = max(best, float(vert_t[y0:y1, xx].mean()))
        return best

    def cover_h(y: int, x0: int, x1: int) -> float:
        best = 0.0
        for dy in (-2, -1, 0, 1, 2):
            yy = y + dy
            if 0 <= yy < h:
                best = max(best, float(horiz_t[yy, x0:x1].mean()))
        return best

    found: list[tuple[float, tuple[float, float, float, float]]] = []
    for i, (xl, a0, a1) in enumerate(v_lines):
        for xr, b0, b1 in v_lines[i + 1:]:
            bw = xr - xl
            if bw < w * 0.08:
                continue
            y0, y1 = max(a0, b0), min(a1, b1)
            if y1 - y0 < h * 0.14:
                continue
            # The top and bottom borders: horizontal lines spanning the two sides.
            tops = [y for y, x0, x1 in h_lines if x0 <= xl + 6 and x1 >= xr - 6 and abs(y - y0) <= h * 0.04]
            bottoms = [y for y, x0, x1 in h_lines if x0 <= xl + 6 and x1 >= xr - 6 and abs(y - y1) <= h * 0.04]
            if not tops or not bottoms:
                continue
            top, bottom = min(tops, key=lambda y: abs(y - y0)), min(bottoms, key=lambda y: abs(y - y1))
            bh = bottom - top
            if bh <= 0:
                continue
            area = bw * bh / (w * h)
            if not (MIN_AREA <= area <= MAX_AREA) or not (MIN_ASPECT <= bw / bh <= MAX_ASPECT):
                continue
            sides = (cover_v(xl, top, bottom), cover_v(xr, top, bottom), cover_h(top, xl, xr), cover_h(bottom, xl, xr))
            if min(sides) < SIDE_COVER:
                continue
            found.append((sum(sides), (xl / w, top / h, bw / w, bh / h)))

    # Strongest borders first; drop repeats and boxes that contain another
    # panel (a box drawn round two panels is the row, not a panel).
    found.sort(key=lambda s: -s[0])
    boxes: list[tuple[float, float, float, float]] = []
    for _, box in found:
        if any(_iou(box, o) >= SAME for o in boxes):
            continue
        boxes.append(box)

    def contains(big, small) -> bool:
        return (big[0] <= small[0] + 0.01 and big[1] <= small[1] + 0.01
                and big[0] + big[2] >= small[0] + small[2] - 0.01 and big[1] + big[3] >= small[1] + small[3] - 0.01)

    boxes = [b for b in boxes if not any(o is not b and contains(b, o) and o[2] * o[3] < b[2] * b[3] * 0.9 for o in boxes)]
    # No panel overlaps another: of two that do, the first (stronger) stays.
    kept: list[tuple[float, float, float, float]] = []
    for b in boxes:
        if all(_iou(b, o) < 0.08 for o in kept):
            kept.append(b)
    if len(kept) < MIN_PANELS:
        return []
    return [tuple(round(v, 4) for v in b) for b in reading_order(kept)]


def reading_order(boxes: list) -> list:
    """Row by row (rows by their centres), left to right."""
    rows: list[list] = []
    for b in sorted(boxes, key=lambda b: b[1] + b[3] / 2):
        cy = b[1] + b[3] / 2
        for row in rows:
            ry = sum(o[1] + o[3] / 2 for o in row) / len(row)
            if abs(cy - ry) < 0.5 * min(b[3], row[0][3]):
                row.append(b)
                break
        else:
            rows.append([b])
    return [b for row in rows for b in sorted(row, key=lambda b: b[0])]


def rows_of(boxes: list) -> list[list]:
    """The panels grouped into their rows, top row first."""
    rows: list[list] = []
    for b in reading_order(boxes):
        cy = b[1] + b[3] / 2
        if rows and abs(cy - (rows[-1][0][1] + rows[-1][0][3] / 2)) < 0.5 * min(b[3], rows[-1][0][3]):
            rows[-1].append(b)
        else:
            rows.append([b])
    return rows


def panel_of(boxes: list, x: float, y: float) -> "tuple | None":
    """The panel a point (shares of the frame) is in, if any."""
    for b in boxes:
        if b[0] <= x <= b[0] + b[2] and b[1] <= y <= b[1] + b[3]:
            return b
    return None


def detect(video: Path, in_ms: int, out_ms: int) -> list[tuple[float, float, float, float]]:
    """The panels of a composite over [in_ms, out_ms), or [] when it isn't one. Never raises."""
    import numpy as np

    try:
        st = Path(video).stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms)
    except OSError:
        return []
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    result: list = []
    try:
        from .. import media

        info = media.probe(video)
        hh = int(round(WIDTH * info.height / max(1, info.width) / 2)) * 2
        length = max(1, out_ms - in_ms)
        frames = []
        for k in range(SAMPLES):
            at = in_ms + int(length * (k + 0.5) / SAMPLES)
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{at / 1000:.3f}", "-i", str(video), "-frames:v", "1",
                                  "-vf", f"scale={WIDTH}:{hh},format=gray", "-f", "rawvideo", "-"],
                                 capture_output=True).stdout
            if len(raw) >= WIDTH * hh:
                frames.append(np.frombuffer(raw[:WIDTH * hh], np.uint8).reshape(hh, WIDTH))
        result = from_frames(frames)
    except Exception:  # noqa: BLE001 - advice only; framing works without it
        log.warning("panel search failed for %s; framing without it", Path(video).name, exc_info=True)
        result = []
    _CACHE[key] = result
    while len(_CACHE) > CACHE_MAX:
        _CACHE.popitem(last=False)
    return result


#: Frames a second read for by_shot, and the fewest a stretch needs.
RATE = 2
MIN_FRAMES = 4

_SPANS: "OrderedDict[tuple, list]" = OrderedDict()


def by_shot(video: Path, in_ms: int, out_ms: int, cuts: list[int]) -> list[tuple[int, int, list]]:
    """(from, to, panels) for each stretch between camera cuts that is a composite.

    A programme changes its line-up as it goes (one guest full frame, then two
    boxes, then five), so the boxes are found per shot: one decode of the range
    at two frames a second, grouped between the cuts. Never raises.
    """
    import numpy as np

    try:
        st = Path(video).stat()
        key = (str(video), st.st_size, int(st.st_mtime), in_ms, out_ms, tuple(cuts))
    except OSError:
        return []
    if key in _SPANS:
        _SPANS.move_to_end(key)
        return _SPANS[key]
    out: list[tuple[int, int, list]] = []
    try:
        from .. import media

        info = media.probe(video)
        hh = int(round(WIDTH * info.height / max(1, info.width) / 2)) * 2
        raw = subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{in_ms / 1000:.3f}", "-t", f"{max(0, out_ms - in_ms) / 1000:.3f}",
             "-i", str(video), "-vf", f"fps={RATE},scale={WIDTH}:{hh},format=gray", "-f", "rawvideo", "-"],
            capture_output=True).stdout
        size = WIDTH * hh
        frames = [(in_ms + int(i * 1000 / RATE), np.frombuffer(raw[i * size:(i + 1) * size], np.uint8).reshape(hh, WIDTH))
                  for i in range(len(raw) // size)]
        edges = [in_ms, *sorted(c for c in cuts if in_ms < c < out_ms), out_ms]
        for a, b in zip(edges, edges[1:]):
            # Leave the frames either side of a cut out: a dissolve smears both pictures.
            inside = [f for ms, f in frames if a + 250 <= ms < b - 250]
            if len(inside) < MIN_FRAMES:
                continue
            step = max(1, len(inside) // 16)
            found = from_frames(inside[::step])
            if found:
                out.append((a, b, found))
    except Exception:  # noqa: BLE001 - advice only; framing works without it
        log.warning("panel search failed for %s; framing without it", Path(video).name, exc_info=True)
        out = []
    _SPANS[key] = out
    while len(_SPANS) > CACHE_MAX:
        _SPANS.popitem(last=False)
    return out


def at(spans: list, a: int, b: int) -> list:
    """The panels on screen through most of [a, b), or []."""
    best, held = [], 0
    for sa, sb, boxes in spans or []:
        over = min(b, sb) - max(a, sa)
        if over > held:
            best, held = boxes, over
    return best if held >= 0.6 * max(1, b - a) else []
