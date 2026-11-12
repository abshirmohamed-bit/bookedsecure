"""Turning a project into a finished vertical video.

One ffmpeg pass builds the whole frame: cut, reframe shot by shot, lay out,
burn captions, draw the title and handle, normalise the audio, encode. The
picture is made from a shot list (shots.py): the clip is split at its camera
cuts, each shot is composed on its own — a crop that follows the speaker, two
people stacked, a screenshot shown whole — and the pieces are joined back
together, so one clip can change layout as its footage does. Every feature is
a function that adds to the filter graph, so the app's Finish panel maps onto
these fields one-to-one.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, replace
from pathlib import Path

from .. import media
from . import camera, looks
from . import frame as framing
from . import shots as shotplan
from .caption import BY_ID, Style, build_ass

log = logging.getLogger("engine.compose")

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}
LAYOUTS = set(shotplan.LAYOUTS)
ZOOMS = set(shotplan.ZOOMS)
CAPTION_POSITIONS = ("top", "middle", "lower")
TITLE_STYLES = ("bold_band", "boxed", "headline", "clean")


@dataclass
class Segment:
    """One cut taken from one source. A clip is an ordered list of these."""
    source: Path
    in_ms: int
    out_ms: int

    @property
    def length_ms(self) -> int:
        return max(0, self.out_ms - self.in_ms)


@dataclass
class Render:
    out: Path
    # A single cut, the common case. Leave these unset and pass `segments`
    # to stitch several cuts — from one video or from many — into one clip.
    source: Path | None = None
    in_ms: int = 0
    out_ms: int = 0
    segments: list[Segment] | None = None
    aspect: str = "9:16"
    layout: str = "full-video"
    framing_mode: str = "auto"              # auto | center | manual
    #: What the clip was chosen for: speaker | reaction | everyone | auto.
    #: A moment picked because of how someone reacted is thrown away by a
    #: tight shot of whoever happens to be talking.
    focus: str = "auto"
    #: off | auto (push in on wide shots) | moments (and punch in on lines)
    zoom: str = "auto"
    words: list[dict] | None = None
    caption_style_id: str = "bold_white"
    captions_enabled: bool = True
    #: Overrides of the style's own placement: top | middle | lower, a size
    #: multiplier, and words per line. None keeps what the style says.
    caption_position: str | None = None
    caption_y: float | None = None          # a dragged position (0 top .. 1 bottom); wins over caption_position
    caption_size: float = 1.0
    caption_max_words: int | None = None
    censored: list[str] | None = None
    title: dict | None = None               # {text, style, enabled}
    watermark: dict | None = None           # {text, position, opacity}
    broll: Path | None = None
    resolution: str = "1080p"
    loudnorm: bool = True
    preview: bool = False
    finish_ass: str | None = None           # Complete editor finish layer, in output time.

    def __post_init__(self) -> None:
        """`segments` is the only truth inside; a lone source becomes one segment."""
        if not self.segments:
            if self.source is None:
                raise ValueError("a render needs either a source or segments")
            self.segments = [Segment(self.source, self.in_ms, self.out_ms)]
        self.segments = [s for s in self.segments if s.length_ms > 0]
        if not self.segments:
            raise ValueError("a clip needs at least one segment with a length")

    @property
    def total_ms(self) -> int:
        """How long the finished clip runs, with every segment laid end to end."""
        return sum(s.length_ms for s in (self.segments or []))

    @property
    def size(self) -> tuple[int, int]:
        w, h = ASPECTS.get(self.aspect, ASPECTS["9:16"])
        if self.preview:
            return (w // 2 - (w // 2) % 2, h // 2 - (h // 2) % 2)
        if self.resolution == "2160p":
            return w * 2, h * 2
        return w, h


def _font_for(style: Style) -> str:
    return style.font


def _escape_drawtext(text: str) -> str:
    """Escape text for a single-quoted drawtext value.

    Kept for the simple cases and for the tests. Anything a person typed goes
    through `_text_source` instead: quoting rules differ between -vf and
    -filter_complex, so a title with an apostrophe that renders correctly in
    one leaks into the filter's parameters in the other. A file has no
    quoting rules at all.
    """
    return (text.replace("\\", r"\\")
            .replace("%", r"\%")
            .replace(":", r"\:")
            .replace("'", r"'\''"))


def fpath(path: Path | str) -> str:
    """A file path as a filter option value.

    Inside a filter graph a colon ends the option, so a Windows drive letter
    has to be escaped; forward slashes are fine everywhere.
    """
    return str(Path(path).as_posix()).replace("\\", "/").replace(":", r"\:")


def _text_source(text: str, workdir: Path | None, name: str) -> str:
    """`textfile=` when there is somewhere to write, `text=` otherwise."""
    if workdir is None:
        return f"text='{_escape_drawtext(text)}'"
    path = workdir / f"{name}.txt"
    path.write_text(text, encoding="utf-8")
    # Bare: the graph runs with the work folder as its working directory (see
    # `run`), and a bare name needs no escaping on any platform.
    return f"textfile={path.name}:reload=0"


def _font_option(workdir: Path | None = None) -> str:
    """How drawtext finds its face: by file when one is configured, else by name.

    With a work folder the font is copied in and named bare, which needs no
    escaping; without one the path is quoted and escaped for a -vf graph.
    """
    import shutil

    from ..config import settings

    file = settings().font_file.strip()
    if not file:
        return ""
    if workdir is not None:
        local = workdir / ("title" + (Path(file).suffix or ".ttf"))
        if not local.exists():
            try:
                shutil.copyfile(file, local)
            except OSError:
                return ""
        return f":fontfile={local.name}"
    return f":fontfile={fpath(file)}"


def wrap_title(text: str, max_chars: int, max_lines: int = 2) -> list[str]:
    """Break a headline into at most `max_lines`, never mid-word."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if len(candidate) <= max_chars or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
            if len(lines) == max_lines:
                break
    if current and len(lines) < max_lines:
        lines.append(current)
    if not lines:
        return []
    # anything that did not fit is trimmed onto the last line with an ellipsis
    used = sum(len(l.split()) for l in lines)
    if used < len(words):
        lines[-1] = lines[-1][: max(0, max_chars - 1)].rstrip() + "…"
    return lines


def title_lines(text: str, w: int, h: int) -> tuple[list[str], int]:
    """(lines, font size) for a headline that always fits.

    ffmpeg cannot measure text for us, so the size is derived from the longest
    line. 0.52em is a safe average advance for a heavy sans. A headline that
    will not fit on two lines at the base size tries a smaller size on three
    before anything is cut off: a title that ends in "…" has lost its point.
    """
    base = max(20, int(h * 0.034))
    usable = w * 0.84
    best: tuple[list[str], int] | None = None
    for max_lines, size in ((2, base), (3, int(base * 0.9)), (3, int(base * 0.8))):
        max_chars = max(10, int(usable / (0.52 * size)))
        lines = wrap_title(text, max_chars, max_lines)
        if not lines:
            return [], size
        if best is None:
            best = (lines, size)
        if not lines[-1].endswith("…"):
            best = (lines, size)
            break
    lines, size = best or ([], base)
    longest = max((len(l) for l in lines), default=1)
    size = max(16, int(min(size, usable / (0.52 * max(1, longest)))))
    return lines, size


#: Where the headline goes: at the top unless told otherwise, or unless the
#: person's head is already up there (see `title_place`).
TITLE_POSITIONS = ("auto", "top", "bottom")
#: A face whose top is above this share of the frame has the headline on it.
HEAD_UP_HIGH = 0.16


def title_place(title: dict, head_top: float | None, top_busy: float = 0.0,
                bottom_busy: float = 0.0) -> str:
    """"top" or "bottom" for this clip's headline.

    Up top unless the head is already there, and then at the bottom only if
    the bottom is the calmer place: a news lower-third is busier than a
    forehead, and the headline goes over the forehead.
    """
    want = title.get("position", "auto")
    if want in {"top", "bottom"}:
        return want
    if head_top is not None and head_top < HEAD_UP_HIGH and bottom_busy <= top_busy:
        return "bottom"
    return "top"


def _title_filter(title: dict, w: int, h: int, workdir: Path | None = None,
                  top: int | None = None, place: str = "top") -> str:
    """A headline that always fits: wrapped, then shrunk to the width."""
    if title.get("enabled") is False:
        return ""
    text = (title.get("text") or "").strip()
    if not text:
        return ""
    kind = title.get("style", "bold_band")
    upper = kind in {"bold_band", "headline"}
    if upper:
        text = text.upper()
    lines, size = title_lines(text, w, h)
    if not lines:
        return ""
    gap = int(size * 1.18)
    block = len(lines) * gap
    if top is not None:
        y0 = top
    elif place == "bottom":
        # Above the handle and clear of the bottom caption band.
        y0 = int(h * 0.80) - block
    else:
        y0 = int(h * 0.06)
    font = _font_option(workdir)
    parts: list[str] = []
    for i, line in enumerate(lines):
        y = y0 + i * gap
        common = (f"{_text_source(line, workdir, f'title_{i}')}{font}:fontcolor=white:fontsize={size}"
                  f":x=(w-text_w)/2:y={y}")
        if kind == "bold_band":
            parts.append(f"drawtext={common}:box=1:boxcolor=black@0.78:boxborderw={int(size * 0.42)}")
        elif kind == "boxed":
            parts.append(f"drawtext={common}:box=1:boxcolor=black@0.6:boxborderw={int(size * 0.32)}")
        elif kind == "headline":
            parts.append(f"drawtext={common}:borderw={max(2, int(size * 0.07))}:bordercolor=black")
        else:
            parts.append(f"drawtext={common}:shadowcolor=black@0.7:shadowx=2:shadowy=2")
    return ",".join(parts)


def _watermark_filter(mark: dict, w: int, h: int, workdir: Path | None = None) -> str:
    text = (mark.get("text") or "").strip()
    if not text:
        return ""
    size = max(14, int(h * 0.018))
    opacity = float(mark.get("opacity", 0.5))
    pos = mark.get("position", "bottom-right")
    x = {"top-left": f"{int(w * 0.05)}", "bottom-left": f"{int(w * 0.05)}",
         "top-right": f"w-text_w-{int(w * 0.05)}", "bottom-right": f"w-text_w-{int(w * 0.05)}",
         "centre-below-captions": "(w-text_w)/2"}.get(pos, f"w-text_w-{int(w * 0.05)}")
    y = {"top-left": f"{int(h * 0.05)}", "top-right": f"{int(h * 0.05)}",
         "bottom-left": f"h-text_h-{int(h * 0.05)}", "bottom-right": f"h-text_h-{int(h * 0.05)}",
         "centre-below-captions": f"{int(h * 0.62)}"}.get(pos, f"h-text_h-{int(h * 0.05)}")
    return (f"drawtext={_text_source(text, workdir, 'watermark')}{_font_option(workdir)}"
            f":fontcolor=white@{opacity}:fontsize={size}:x={x}:y={y}")


def stitch(render: Render, workdir: Path) -> tuple[Path, int, int]:
    """Lay the segments end to end and return (file, in_ms, out_ms) to render from.

    One segment is the common case and is handed straight back, so nothing is
    re-encoded needlessly. Several segments — from one video or from many — are
    each normalised to a shared frame, frame rate and audio layout first,
    because the concat demuxer can only join streams that already match.
    """
    segments = render.segments or []
    if len(segments) == 1:
        s = segments[0]
        return s.source, s.in_ms, s.out_ms

    probes = [media.probe(s.source) for s in segments]
    # cover-and-crop to a shared frame: no black bars, no squashing
    cw = max(2, max(p.width for p in probes))
    ch = max(2, max(p.height for p in probes))
    cw, ch = cw - cw % 2, ch - ch % 2
    fps = max(24.0, max(p.fps for p in probes))

    parts: list[Path] = []
    for i, seg in enumerate(segments):
        part = workdir / f"seg{i:03d}.mp4"
        media.ffmpeg([
            "-ss", f"{seg.in_ms / 1000:.3f}", "-t", f"{seg.length_ms / 1000:.3f}",
            "-i", str(seg.source),
            "-vf", (f"scale={cw}:{ch}:flags=lanczos:force_original_aspect_ratio=increase,"
                    f"crop={cw}:{ch},fps={fps:.3f},setsar=1"),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
            # every part needs audio, or concat drops the stream partway through
            "-af", "aresample=async=1:first_pts=0",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-shortest", "-y", str(part),
        ])
        parts.append(part)

    listing = workdir / "segments.txt"
    listing.write_text(
        "".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
    joined = workdir / "stitched.mp4"
    media.ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing),
                  "-c", "copy", "-y", str(joined)])
    return joined, 0, render.total_ms


def remap_words(words: list[dict], segments: list[Segment]) -> list[dict]:
    """Move word timings from their source timelines onto the stitched one.

    A word belongs to a segment when it falls inside that segment's span; its
    timing shifts by however much footage precedes that segment in the output.
    Words in the gaps were cut away, so they are dropped.
    """
    out: list[dict] = []
    offset = 0
    for seg in segments:
        src = str(seg.source)
        for w in words:
            # words carry `source` only on multi-source clips; one source needs no tag
            if w.get("source") not in (None, "", src):
                continue
            start, end = int(w.get("start_ms", 0)), int(w.get("end_ms", 0))
            if end <= seg.in_ms or start >= seg.out_ms:
                continue
            start, end = max(start, seg.in_ms), min(end, seg.out_ms)
            out.append({**w,
                        "start_ms": start - seg.in_ms + offset,
                        "end_ms": end - seg.in_ms + offset})
        offset += seg.length_ms
    out.sort(key=lambda w: w["start_ms"])
    return out


def flatten(render: Render, workdir: Path) -> Render:
    """Collapse the segments into one real file so the rest of the graph is unchanged.

    Face tracking, captions, title and watermark all work on a single
    continuous timeline; stitching first means they need to know nothing about
    how many pieces the clip was cut from.
    """
    segments = render.segments or []
    if len(segments) == 1:
        s = segments[0]
        return replace(render, source=s.source, in_ms=s.in_ms, out_ms=s.out_ms)
    workdir.mkdir(parents=True, exist_ok=True)
    joined, in_ms, out_ms = stitch(render, workdir)
    return replace(
        render, source=joined, in_ms=in_ms, out_ms=out_ms,
        segments=[Segment(joined, in_ms, out_ms)],
        words=remap_words(render.words or [], segments) if render.words else render.words,
    )


# ------------------------------------------------------------------ the plan

def plan_for(render: Render) -> tuple[list[shotplan.Shot], shotplan.Inputs]:
    """The shot list for this render, from one analysis of its range.

    The render and the editor's preview both come here, so what the editor
    draws is what gets made. Any failure in the analysis falls back to a
    centred crop rather than a failed export.
    """
    w, h = render.size
    source = render.source
    assert source is not None
    track = None
    tracks: list = []
    turns_: list = []
    cuts: list[int] = []
    detail: list = []
    if render.framing_mode not in {"center", "manual"}:
        try:
            track, tracks, turns_, cuts, detail = framing.analyse(
                source, in_ms=render.in_ms, out_ms=render.out_ms)
        except Exception:
            log.exception("shot analysis failed; rendering a centred crop")
    sw = getattr(track, "width", 0) or 0
    sh = getattr(track, "height", 0) or 0
    if not sw or not sh:
        try:
            info = media.probe(source)
            sw, sh = info.width, info.height
        except Exception:
            sw, sh = w, h
    inputs = shotplan.Inputs(
        width=sw, height=sh, out_w=w, out_h=h, in_ms=render.in_ms, out_ms=render.out_ms,
        tracks=tracks, turns=turns_, cuts=cuts, detail=detail, track=track,
        layout=render.layout, focus=render.focus, zoom=render.zoom, words=render.words,
    )
    plan = shotplan.plan(inputs)
    try:
        camera.apply(plan, inputs, source)
    except Exception:
        # Without the camera moves the shots still hold their framing.
        log.exception("camera moves failed; holding each shot still")
        for shot in plan:
            shot.motion, shot.transition = [], None
    return plan, inputs


# ------------------------------------------------------------------ per-shot graphs

def _frame(ms: int) -> int:
    """The 30 fps frame index at `ms` from the start of the render."""
    return max(0, int(round(ms * 30 / 1000)))


def _seconds(ms: int) -> str:
    return f"{max(0, ms) / 1000:.3f}"


def _pan_file(shot: shotplan.Shot, name: str, workdir: Path, starts_ms: int | None = None) -> str:
    """The crop over the shot, as a sendcmd script in shot time.

    With camera motion it moves every frame (x, y and size: glides, the
    breathing zoom, punch-ins); otherwise it steps x along the pan.
    """
    t0 = shot.start_ms if starts_ms is None else starts_ms
    lines = []
    if shot.motion:
        for ms, x, y, cw, ch in shot.motion:
            if ms < t0:
                continue
            lines.append(f"{(ms - t0) / 1000:.3f} {name} x {x}, {name} y {y}, {name} w {cw}, {name} h {ch};")
    else:
        for ms, x in shot.pan:
            lines.append(f"{max(0.0, (ms - t0) / 1000):.3f} {name} x {x};")
    path = workdir / f"{name.replace('@', '_')}.cmd"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path.name


def _knots(values: list[float], tolerance: float = 0.3) -> list[int]:
    """Frame indexes where a piecewise-linear line through `values` must bend
    to stay within `tolerance` px of every frame (greedy, from the left)."""
    n = len(values)
    if n <= 2:
        return list(range(n))
    knots = [0]
    a = 0
    b = 2
    while b < n:
        # Can a straight line a..b stay within tolerance of every frame between?
        va, vb = values[a], values[b]
        ok = all(abs(va + (vb - va) * (k - a) / (b - a) - values[k]) <= tolerance for k in range(a + 1, b))
        if ok:
            b += 1
            continue
        a = b - 1
        knots.append(a)
        b = a + 2
    knots.append(n - 1)
    return knots


def _ramp(values: list[float], first_frame: int) -> str:
    """An ffmpeg expression of the frame number `in` that follows `values`
    (one per frame, starting at frame `first_frame`).

    Written as a flat sum of clipped ramps, v0 + sum(slope * clip(in - n, 0, len)),
    so a long, detailed path doesn't nest hundreds of ifs.
    """
    knots = _knots(values)
    terms = [f"{values[0]:.2f}"]
    for a, b in zip(knots, knots[1:]):
        slope = (values[b] - values[a]) / (b - a)
        if abs(slope) < 1e-4:
            continue
        terms.append(f"{slope:+.4f}*clip(in-{first_frame + a},0,{b - a})")
    return "".join(terms)


def camera_chain(shot: shotplan.Shot, t0: int, t_end: int, sw: int, sh: int) -> str:
    """The filters that move the camera over a fill shot, frame by frame.

    A fixed crop around everywhere the camera goes, then `perspective`,
    re-evaluated every frame, maps that frame's crop onto the picture with
    sub-pixel sampling. The picture's size never changes mid-stream, which
    matters: ffmpeg 7's scale filter drops the rest of a stream when the
    size of its input keeps changing.
    """
    frames = [m for m in shot.motion if t0 <= m[0] < t_end] or shot.motion[:1]
    bx = max(0, int(min(m[1] for m in frames)))
    by = max(0, int(min(m[2] for m in frames)))
    bx2 = min(sw, int(math.ceil(max(m[1] + m[3] for m in frames))))
    by2 = min(sh, int(math.ceil(max(m[2] + m[4] for m in frames))))
    bw, bh = bx2 - bx, by2 - by
    # Even sizes for the chroma planes; grow rather than cut into the picture.
    if bw % 2:
        bw, bx = (bw + 1, bx) if bx + bw + 1 <= sw else (bw + 1, bx - 1) if bx else (bw - 1, bx)
    if bh % 2:
        bh, by = (bh + 1, by) if by + bh + 1 <= sh else (bh + 1, by - 1) if by else (bh - 1, by)
    # `in` counts this filter's frames from 1; one value per output frame of the shot.
    left = [m[1] - bx for m in frames]
    top = [m[2] - by for m in frames]
    right = [m[1] + m[3] - bx for m in frames]
    bottom = [m[2] + m[4] - by for m in frames]
    X, Y, R, B = (_ramp(v, 1) for v in (left, top, right, bottom))
    return (f"crop={bw}:{bh}:{bx}:{by},"
            f"perspective=x0='{X}':y0='{Y}':x1='{R}':y1='{Y}':x2='{X}':y2='{B}':x3='{R}':y3='{B}'"
            ":interpolation=linear:eval=frame")


def _scale(w: int, h: int) -> str:
    return f"scale={w}:{h}:flags=lanczos"


def _fit_chain(w: int, h: int) -> str:
    return f"scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos"


def _moving(shot: shotplan.Shot) -> bool:
    return len({m[1:] for m in shot.motion}) > 1


def _shot_graph(shot: shotplan.Shot, i: int, inputs: shotplan.Inputs, w: int, h: int,
                workdir: Path, pad_in: int = 0, pad_out: int = 0) -> tuple[list[str], int]:
    """Filter graph lines turning [s{i}] into [v{i}]. Returns (lines, copies of [s{i}] used).

    pad_in/pad_out run the shot that many ms past its edges, for a
    transition to overlap into.
    """
    t0 = shot.start_ms - pad_in
    t_end = shot.end_ms + pad_out
    # Frames in this shot's stream (stills used by its looks run exactly as long).
    frames = int((t_end - t0) * 30 / 1000) + 2
    # Cut on whole frames of the 30 fps stream, not on times: neighbouring shots
    # then share their boundary frame exactly and no frame is lost between them.
    # (Cutting by time dropped a frame at some joins; with dozens of shots the
    # picture ran up to 0.2 s ahead of its sound by the end.)
    head = (f"trim=start_frame={_frame(t0 - inputs.in_ms)}:end_frame={_frame(shot.end_ms + pad_out - inputs.in_ms)},"
            "setpts=PTS-STARTPTS")
    s = f"s{i}"
    out = f"v{i}"
    lines: list[str] = []

    def fill(label_in: str, label_out: str) -> None:
        win = shot.window
        assert win is not None
        name = f"crop@c{i}"
        if _moving(shot):
            lines.append(f"[{label_in}]{camera_chain(shot, t0, t_end, inputs.width, inputs.height)},"
                         f"{_scale(w, h)},setsar=1[{label_out}]")
            return
        pan = f"sendcmd=f={_pan_file(shot, name, workdir, t0)}," if len(shot.pan) > 1 else ""
        lines.append(f"[{label_in}]{pan}{name}={win.w}:{win.h}:{win.x}:{win.y},{_scale(w, h)},setsar=1[{label_out}]")

    def fit(label_in: str, label_out: str, copies_from: str | None = None) -> None:
        # Ambient glass: the whole picture as a rounded card with a soft shadow,
        # floating over a blurred, slightly richer copy of itself.
        sw, sh = max(1, inputs.width), max(1, inputs.height)
        fw = looks.even(w * looks.GLASS_WIDTH)
        fh = looks.even(fw * sh / sw)
        if fh > h * looks.GLASS_WIDTH:
            fh = looks.even(h * looks.GLASS_WIDTH)
            fw = looks.even(fh * sw / sh)
        lines.append(f"[{label_in}]split=2[{label_out}a][{label_out}b]")
        lines.append(looks.ambient(f"{label_out}a", f"{label_out}bg", w, h))
        lines.append(f"[{label_out}b]scale={fw}:{fh}:flags=lanczos,setsar=1[{label_out}fg]")
        looks.card(lines, base=f"{label_out}bg", picture=f"{label_out}fg", out=f"{label_out}x",
                   x=(w - fw) // 2, y=(h - fh) // 2, w=fw, h=fh, out_w=w, workdir=workdir, name=f"g{i}{label_out}", frames=frames)
        lines.append(f"[{label_out}x]setsar=1[{label_out}]")

    if shot.kind == "fill":
        lines.append(f"[{s}]{head}[{s}t]")
        fill(f"{s}t", out)
        return lines, 1
    if shot.kind == "fit":
        lines.append(f"[{s}]{head}[{s}t]")
        fit(f"{s}t", out)
        return lines, 1
    if shot.kind == "headline":
        # Podcast poster: the picture as a rounded card over the blur, with the
        # headline above it (drawn later) and a progress bar along the bottom.
        lines.append(f"[{s}]{head}[{s}t]")
        fit(f"{s}t", out)
        return lines, 1
    if shot.kind in {"bars", "headline"}:
        lines.append(f"[{s}]{head},split=2[{s}a][{s}b]")
        lines.append(looks.ambient(f"{s}a", f"{s}bg0", w, h, brightness=looks.CINEMA_BRIGHTNESS))
        lines.append(f"[{s}bg0]vignette=angle={looks.VIGNETTE}[{s}bg]")
        lines.append(f"[{s}b]{_fit_chain(w, h)}[{s}fg]")
        lines.append(f"[{s}bg][{s}fg]overlay=(W-w)/2:(H-h)/2,setsar=1[{out}]")
        return lines, 1
    if shot.kind == "feed":
        box = shot.main
        assert box is not None
        lines.append(f"[{s}]{head},{box.crop()},{_scale(w, h)},setsar=1[{out}]")
        return lines, 1
    if shot.kind in {"split", "grid"}:
        cells = shot.cells
        k = len(cells)
        portrait = h >= w
        if k == 4:
            cw, ch = w // 2 - (w // 2) % 2, h // 2 - (h // 2) % 2
        elif portrait:
            cw, ch = w, h // k - (h // k) % 2
        else:
            cw, ch = w // k - (w // k) % 2, h
        if k == 2 and portrait:
            m, gap = looks.even(w * looks.DUO_MARGIN), looks.even(w * looks.DUO_GAP)
            cw2 = looks.even(w - 2 * m)
            ch2 = looks.even((h - 2 * m - gap) / 2)
            lines.append(f"[{s}]{head},split=3[{s}p0][{s}p1][{s}a]")
            lines.append(looks.ambient(f"{s}a", f"{s}bg", w, h))
            for j, box in enumerate(cells[:2]):
                lines.append(f"[{s}p{j}]{box.crop()},scale={cw2}:{ch2}:force_original_aspect_ratio=increase:flags=lanczos,"
                             f"crop={cw2}:{ch2},setsar=1[{s}k{j}]")
            looks.card(lines, base=f"{s}bg", picture=f"{s}k0", out=f"{s}c0", x=m, y=m, w=cw2, h=ch2,
                       out_w=w, workdir=workdir, name=f"d{i}a", frames=frames)
            looks.card(lines, base=f"{s}c0", picture=f"{s}k1", out=f"{s}c1", x=m, y=m + ch2 + gap, w=cw2, h=ch2,
                       out_w=w, workdir=workdir, name=f"d{i}b", frames=frames)
            lines.append(f"[{s}c1]setsar=1[{out}]")
            return lines, 1
        if shot.kind == "grid" and ((k == 3 and portrait) or k == 4):
            # Spotlight (3) or a 2 x 2 (4) of rounded cards over the blurred frame.
            spots = looks.spotlight_cards(w, h) if k == 3 else looks.quad_cards(w, h)
            lines.append(f"[{s}]{head},split={k + 1}" + "".join(f"[{s}p{j}]" for j in range(k)) + f"[{s}a]")
            lines.append(looks.ambient(f"{s}a", f"{s}bg", w, h))
            base = f"{s}bg"
            for j, (box, (x, y, bw, bh)) in enumerate(zip(cells, spots)):
                lines.append(f"[{s}p{j}]{box.crop()},scale={bw}:{bh}:force_original_aspect_ratio=increase:flags=lanczos,"
                             f"crop={bw}:{bh},setsar=1[{s}k{j}]")
                looks.card(lines, base=base, picture=f"{s}k{j}", out=f"{s}g{j}", x=x, y=y, w=bw, h=bh,
                           out_w=w, workdir=workdir, name=f"q{i}{j}", frames=frames)
                base = f"{s}g{j}"
            lines.append(f"[{base}]setsar=1[{out}]")
            return lines, 1
        lines.append(f"[{s}]{head},split={k}" + "".join(f"[{s}p{j}]" for j in range(k)))
        for j, box in enumerate(cells):
            lines.append(f"[{s}p{j}]{box.crop()},{_scale(cw, ch)},setsar=1[{s}k{j}]")
        if k == 4:
            lines.append(f"[{s}k0][{s}k1]hstack=inputs=2[{s}r0]")
            lines.append(f"[{s}k2][{s}k3]hstack=inputs=2[{s}r1]")
            lines.append(f"[{s}r0][{s}r1]vstack=inputs=2,{_scale(w, h)},setsar=1[{out}]")
        else:
            stack = "vstack" if portrait else "hstack"
            lines.append("".join(f"[{s}k{j}]" for j in range(k)) + f"{stack}=inputs={k},{_scale(w, h)},setsar=1[{out}]")
        return lines, 1
    if shot.kind == "screen":
        top, bottom = shotplan.screen_split(inputs)
        box = shot.main
        assert box is not None
        # Presenter: the screen and the speaker as two rounded cards over the blur.
        m, g = looks.even(w * looks.DUO_MARGIN), looks.even(w * looks.DUO_GAP)
        cw = looks.even(w - 2 * m)
        th = looks.even(top - m - g / 2)
        bh = looks.even(h - top - m - g / 2)
        lines.append(f"[{s}]{head},split=3[{s}a][{s}b][{s}c]")
        lines.append(looks.ambient(f"{s}c", f"{s}bg", w, h))
        lines.append(f"[{s}a]scale={cw}:{th}:force_original_aspect_ratio=increase:flags=lanczos,crop={cw}:{th},setsar=1[{s}sc]")
        lines.append(f"[{s}b]{box.crop()},scale={cw}:{bh}:force_original_aspect_ratio=increase:flags=lanczos,crop={cw}:{bh},setsar=1[{s}pe]")
        looks.card(lines, base=f"{s}bg", picture=f"{s}sc", out=f"{s}t", x=m, y=m, w=cw, h=th,
                   out_w=w, workdir=workdir, name=f"p{i}a", frames=frames)
        looks.card(lines, base=f"{s}t", picture=f"{s}pe", out=f"{s}u", x=m, y=m + th + g, w=cw, h=bh,
                   out_w=w, workdir=workdir, name=f"p{i}b", frames=frames)
        lines.append(f"[{s}u]setsar=1[{out}]")
        return lines, 1
    if shot.kind == "pip":
        inset = shot.inset
        assert inset is not None
        iw = int(w * 0.30)
        iw -= iw % 2
        ih = int(iw / 0.75)
        ih -= ih % 2
        lines.append(f"[{s}]{head},split=2[{s}m][{s}q]")
        if shot.base == "fit" or shot.window is None:
            fit(f"{s}m", f"{s}base")
        else:
            fill(f"{s}m", f"{s}base")
        lines.append(f"[{s}q]{inset.crop()},{_scale(iw, ih)},setsar=1[{s}in]")
        looks.card(lines, base=f"{s}base", picture=f"{s}in", out=f"{s}pp", x=w - iw - int(w * 0.04), y=int(h * 0.18),
                   w=iw, h=ih, out_w=w, workdir=workdir, name=f"b{i}", frames=frames)
        lines.append(f"[{s}pp]setsar=1[{out}]")
        return lines, 1
    raise ValueError(f"unknown shot kind {shot.kind}")


def build(render: Render, workdir: Path) -> tuple[list[str], Path]:
    """Assemble the ffmpeg arguments. Returns (args, path of the work folder)."""
    workdir.mkdir(parents=True, exist_ok=True)
    render = flatten(render, workdir)
    w, h = render.size
    dur_s = max(0.1, (render.out_ms - render.in_ms) / 1000)

    plan, inputs = plan_for(render)
    if not plan:
        plan = [shotplan.Shot(render.in_ms, render.out_ms, "bars", why="nothing to frame")]

    chain: list[str] = []
    n = len(plan)
    chain.append(f"[0:v]fps=30,split={n}" + "".join(f"[s{i}]" for i in range(n)))
    half = camera.TRANSITION_MS // 2
    for i, shot in enumerate(plan):
        pad_in = half if shot.transition else 0
        pad_out = half if i + 1 < n and plan[i + 1].transition else 0
        lines, _ = _shot_graph(shot, i, inputs, w, h, workdir, pad_in, pad_out)
        chain.extend(lines)
    if n == 1:
        chain[-1] = chain[-1].rsplit("[v0]", 1)[0] + "[joined]"
    else:
        chain.extend(join_shots(plan, out="joined"))
    # Every frame timed by its index. Joined shots carry the right number of
    # frames, but a few joins can repeat a timestamp, and the encoder then
    # drops those frames: the picture ended up to 0.37 s short of the sound,
    # running ahead of it by the end of the clip.
    chain.append("[joined]setpts=N/(30*TB)[base]")
    # The cards' masks and shadows, each read once for the whole render.
    chain[1:1] = looks.emit_stills(workdir, int((render.out_ms - render.in_ms) * 30 / 1000) + 8)

    # The headline layout keeps its picture in the middle band: the title
    # goes in the black above it, centred in that band.
    title_top: int | None = None
    if plan and plan[0].kind == "headline" and inputs.width and inputs.height:
        fit_h = min(h, int(w * looks.GLASS_WIDTH * inputs.height / inputs.width))
        band = (h - fit_h) // 2
        lines_, size = title_lines(((render.title or {}).get("text") or "").upper(), w, h)
        block = len(lines_) * int(size * 1.18) if lines_ else 0
        title_top = max(int(h * 0.04), (band - block) // 2) if band > block else None

    # Heads up against the top of the frame get the headline at the bottom.
    tops = [b[1][1] - b[1][3] / 2 for t in inputs.tracks for b in t.boxes]
    head_top = sorted(tops)[len(tops) // 2] if tops else None
    bands = [(e[3], e[4]) for e in inputs.detail if len(e) > 4]
    top_busy = sorted(b[0] for b in bands)[len(bands) // 2] if bands else 0.0
    bottom_busy = sorted(b[1] for b in bands)[len(bands) // 2] if bands else 0.0
    place = title_place(render.title or {}, head_top, top_busy, bottom_busy)
    last = _overlays(render, workdir, chain, w, h, title_top=title_top, place=place)

    args = ["-ss", f"{render.in_ms / 1000:.3f}", "-t", f"{dur_s:.3f}", "-i", str(render.source),
            *_graph_args(";".join(chain), workdir), "-map", f"[{last}]", "-map", "0:a?"]
    if render.loudnorm:
        args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    args += _encode_args(render)
    args.append(str(render.out))
    return args, workdir


def join_shots(plan: list[shotplan.Shot], out: str = "base") -> list[str]:
    """Join [v0]..[vN] into [base]: straight cuts where the camera cut, a
    6-frame transition where only the composition changed.

    A transition overlaps the two shots by TRANSITION_MS, and each side was
    run TRANSITION_MS/2 past its edge, so the clip keeps its exact length
    and the change lands where the plan put it.
    """
    n = len(plan)
    if not any(s.transition for s in plan[1:]):
        return ["".join(f"[v{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0[{out}]"]
    d = camera.TRANSITION_MS
    half = d // 2
    lines = [f"[v{i}]fps=30,settb=AVTB,format=yuv420p[n{i}]" for i in range(n)]
    def trimmed(i: int) -> int:
        return (plan[i].length_ms + (half if plan[i].transition and i else 0)
                + (half if i + 1 < n and plan[i + 1].transition else 0))

    acc = "n0"
    length = trimmed(0)          # the joined picture so far, ms
    final = out
    for i in range(1, n):
        out = final if i == n - 1 else f"j{i}"
        if plan[i].transition:
            lines.append(f"[{acc}][n{i}]xfade=transition={plan[i].transition}:duration={d / 1000:.3f}:"
                         f"offset={max(0, length - d) / 1000:.3f}[{out}]")
            length += trimmed(i) - d
        else:
            lines.append(f"[{acc}][n{i}]concat=n=2:v=1:a=0[{out}]")
            length += trimmed(i)
        acc = out
    return lines


def _captions_ass(render: Render, w: int, h: int) -> str:
    style = BY_ID.get(render.caption_style_id, BY_ID["bold_white"])
    return build_ass(render.words or [], style, w, h, censored=render.censored,
                     position=render.caption_position, size_scale=render.caption_size, y=render.caption_y,
                     max_words=render.caption_max_words)


def _overlays(render: Render, workdir: Path, chain: list[str], w: int, h: int,
              title_top: int | None = None, place: str = "top") -> str:
    """Append captions, title and watermark to a filter_complex graph.

    Takes the graph ending in [base] and returns the name of the last link, so
    the caller can map it.
    """
    last = "base"
    if render.finish_ass is not None:
        ass = workdir / "finish.ass"
        ass.write_text(render.finish_ass, encoding="utf-8")
        chain.append(f"[{last}]subtitles={ass.name}[finish]")
        return "finish"
    if render.captions_enabled and render.words:
        ass = workdir / "captions.ass"
        ass.write_text(_captions_ass(render, w, h), encoding="utf-8")
        chain.append(f"[{last}]subtitles={ass.name}[cap]")
        last = "cap"
    if render.layout == "title-subtitles":
        # A thin bar that fills across the bottom as the clip plays.
        bar_h = max(4, looks.even(h * looks.PROGRESS_HEIGHT))
        dur = max(0.1, render.total_ms / 1000)
        chain.append(f"color=c={looks.PROGRESS_COLOUR}:s={w}x{bar_h}:r=30:d={dur:.3f}[pbar]")
        chain.append(f"[{last}][pbar]overlay=x='-W+W*t/{dur:.3f}':y=H-h-{int(h * looks.PROGRESS_LIFT)}:eof_action=pass[prog]")
        last = "prog"
    for name, f in (("title", _title_filter(render.title or {}, w, h, workdir, top=title_top, place=place)),
                    ("mark", _watermark_filter(render.watermark or {}, w, h, workdir))):
        if f:
            chain.append(f"[{last}]{f}[{name}]")
            last = name
    return last


#: Graphs longer than this go to ffmpeg as a file: a long clip with many
#: moving shots can exceed a command line (Windows stops at 32 K characters,
#: Linux at 128 K per argument).
GRAPH_FILE_OVER = 6000


def _graph_args(graph: str, workdir: Path) -> list[str]:
    if len(graph) <= GRAPH_FILE_OVER:
        return ["-filter_complex", graph]
    path = workdir / "graph.txt"
    path.write_text(graph, encoding="utf-8")
    # "-/option file" reads the option's value from a file (ffmpeg 7+). The
    # path is a plain argument, not part of a graph, so it needs no escaping.
    return ["-/filter_complex", str(path.resolve())]


def graph_of(args: list[str]) -> str:
    """The filter graph inside a built argument list, for tests and logs."""
    for flag in ("-filter_complex", "-vf"):
        if flag in args:
            return args[args.index(flag) + 1]
    if "-/filter_complex" in args:
        return Path(args[args.index("-/filter_complex") + 1]).read_text(encoding="utf-8")
    return ""


def _encode_args(render: Render) -> list[str]:
    if render.preview:
        return ["-c:v", "libx264", "-crf", "28", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]
    crf = "18" if render.resolution == "2160p" else "20"
    return ["-c:v", "libx264", "-crf", crf, "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"]


def run(render: Render, workdir: Path) -> Path:
    args, _ = build(render, workdir)
    render.out.parent.mkdir(parents=True, exist_ok=True)
    # Source and output are absolute; the graph's own files are bare names
    # resolved against the work folder.
    special = {str(render.out)} | {str(s.source) for s in (render.segments or [])}
    args = [str(Path(a).resolve()) if a in special else a for a in args]
    media.ffmpeg(args, cwd=workdir)
    return render.out
