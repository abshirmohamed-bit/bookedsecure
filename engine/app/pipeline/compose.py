"""Turning a project into a finished vertical video.

One ffmpeg pass builds the whole frame: cut, reframe, layout, burn captions,
draw the title and handle, normalise the audio, encode. Every feature is a
function that adds to the filter graph, so the app's Finish panel maps onto
these fields one-to-one.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

from .. import media
from . import frame as framing
from .caption import BY_ID, Style, build_ass

ASPECTS = {"9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "16:9": (1920, 1080)}
LAYOUTS = {"auto", "full-video", "streamer", "black-box", "title-subtitles", "split"}


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
    words: list[dict] | None = None
    caption_style_id: str = "bold_white"
    captions_enabled: bool = True
    censored: list[str] | None = None
    title: dict | None = None               # {text, style, position}
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


def _text_source(text: str, workdir: Path | None, name: str) -> str:
    """`textfile=` when there is somewhere to write, `text=` otherwise."""
    if workdir is None:
        return f"text='{_escape_drawtext(text)}'"
    path = workdir / f"{name}.txt"
    path.write_text(text, encoding="utf-8")
    return f"textfile={path.as_posix()}:reload=0"


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
        lines[-1] = lines[-1][: max(0, max_chars - 1)].rstrip() + "\u2026"
    return lines


def _title_filter(title: dict, w: int, h: int, workdir: Path | None = None) -> str:
    """A headline that always fits: wrapped to two lines, then shrunk to the width.

    ffmpeg cannot measure text for us, so the size is derived from the longest
    line. 0.52em is a safe average advance for a heavy sans.
    """
    text = (title.get("text") or "").strip()
    if not text:
        return ""
    kind = title.get("style", "bold_band")
    upper = kind in {"bold_band", "headline"}
    if upper:
        text = text.upper()

    base = max(20, int(h * 0.034))
    usable = w * 0.84
    # start from the base size, wrap to what fits, then shrink if a line is still long
    max_chars = max(10, int(usable / (0.52 * base)))
    lines = wrap_title(text, max_chars)
    if not lines:
        return ""
    longest = max(len(l) for l in lines)
    size = int(min(base, usable / (0.52 * max(1, longest))))
    size = max(16, size)

    gap = int(size * 1.18)
    top = int(h * 0.06)
    parts: list[str] = []
    for i, line in enumerate(lines):
        y = top + i * gap
        common = (f"{_text_source(line, workdir, f'title_{i}')}:fontcolor=white:fontsize={size}"
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
    return f"drawtext={_text_source(text, workdir, 'watermark')}:fontcolor=white@{opacity}:fontsize={size}:x={x}:y={y}"


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


def build(render: Render, workdir: Path) -> tuple[list[str], Path]:
    """Assemble the ffmpeg arguments. Returns (args, path of the sendcmd file or /dev/null)."""
    workdir.mkdir(parents=True, exist_ok=True)
    render = flatten(render, workdir)
    w, h = render.size
    dur_s = max(0.1, (render.out_ms - render.in_ms) / 1000)

    inputs: list[str] = ["-ss", f"{render.in_ms / 1000:.3f}", "-t", f"{dur_s:.3f}", "-i", str(render.source)]
    chain: list[str] = []

    track = framing.track(render.source, mode=render.framing_mode,
                          in_ms=render.in_ms, out_ms=render.out_ms) if render.framing_mode != "center" else None
    sendcmd_path = workdir / "pan.cmd"

    # "auto" asks the faces and the voices what shape the clip wants. The
    # decision itself lives in framing.plan, which the editor's preview also
    # calls — worked out separately they would drift, and a preview that does
    # not match the render is worse than none.
    one_feed = ""
    layout = render.layout
    if track is not None and render.source is not None:
        # Shot by shot: re-aimed on every cut, held still within a shot, on
        # the speaker when the people cannot all fit (on everyone, or the
        # most prominent face, for a reaction clip). See director.py.
        track = framing.direct(track, render.source, w, h, in_ms=render.in_ms,
                               out_ms=render.out_ms, focus=render.focus)
    if layout == "auto":
        tracks, turns_, cuts = ((), (), [])  # nothing known until the clip is read
        if track is not None and render.source is not None:
            tracks, turns_, cuts = framing.speech(render.source,
                                                  in_ms=render.in_ms, out_ms=render.out_ms)
        chosen = framing.plan(track, tracks, turns_, w, h, render.focus, cuts)
        layout = chosen["layout"]
        if chosen["feed"]:
            f = chosen["feed"]
            one_feed = f"crop={f['w']}:{f['h']}:{f['x']}:{f['y']}"

    cells = framing.cell_crops(track, w, h, 2) if layout == "split" and track else []
    if layout == "split" and not cells:
        layout = "full-video"
    if layout == "one-feed" and not one_feed:
        layout = "split" if cells else "full-video"

    if layout in {"full-video", "title-subtitles"}:
        crop, commands = framing.crop_filter(
            track or framing.Track("center", 0, 0, [], []), w, h, render.out_ms - render.in_ms)
        pan = _shift(commands, sendcmd_path, render.in_ms)
        if pan:
            chain.append(pan.rstrip(","))
        chain.append(crop)
        chain.append(f"scale={w}:{h}:flags=lanczos")
    elif layout == "streamer":
        # the clip over a blurred, filled copy of itself
        return _two_layer(render, workdir, blur=True, track=track)
    elif layout == "one-feed":
        # the side of the composite the clip is actually about
        chain.append(one_feed)
        chain.append(f"scale={w}:{h}:flags=lanczos")
    elif layout == "split":
        # one cell per speaker, each framed on their own face
        return _split_stack(render, workdir, cells)
    elif layout == "black-box":
        chain.append(f"scale={w}:-2:flags=lanczos")
        chain.append(f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black")
    else:
        chain.append(f"scale={w}:{h}:flags=lanczos:force_original_aspect_ratio=increase")
        chain.append(f"crop={w}:{h}")

    chain.append("setsar=1")

    if render.finish_ass is not None:
        ass = workdir / "finish.ass"
        ass.write_text(render.finish_ass, encoding="utf-8")
        chain.append(f"subtitles={ass.as_posix()}")
    elif render.captions_enabled and render.words:
        style = BY_ID.get(render.caption_style_id, BY_ID["bold_white"])
        ass = workdir / "captions.ass"
        ass.write_text(build_ass(render.words, style, w, h, censored=render.censored), encoding="utf-8")
        chain.append(f"subtitles={ass.as_posix()}")

    if render.title and render.finish_ass is None:
        f = _title_filter(render.title, w, h, workdir)
        if f:
            chain.append(f)
    if render.watermark and render.finish_ass is None:
        f = _watermark_filter(render.watermark, w, h, workdir)
        if f:
            chain.append(f)

    vf = ",".join(c for c in chain if c)
    args = [*inputs, "-vf", vf]
    if render.loudnorm:
        args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    args += _encode_args(render)
    args.append(str(render.out))
    return args, sendcmd_path


def _shift(commands: str | None, sendcmd_path: Path, in_ms: int) -> str:
    """Write the pan script with times relative to the trimmed clip."""
    if not commands:
        return ""
    shifted = []
    for line in commands.splitlines():
        at, _, rest = line.partition(" ")
        try:
            shifted.append(f"{max(0.0, float(at) - in_ms / 1000):.2f} {rest}")
        except ValueError:
            shifted.append(line)
    sendcmd_path.write_text("\n".join(shifted), encoding="utf-8")
    return f"sendcmd=f={sendcmd_path.as_posix()},"


def _two_layer(render: Render, workdir: Path, blur: bool,
               track: framing.Track | None = None) -> tuple[list[str], Path]:
    """Streamer layout: the clip sits over a blurred fill of itself.

    The subject is tracked here too. Without it the speaker sits wherever they
    happened to stand and the blur does all the work, which is the look of a
    clip nobody edited.
    """
    w, h = render.size
    dur_s = max(0.1, (render.out_ms - render.in_ms) / 1000)
    sendcmd_path = workdir / "pan.cmd"
    crop, commands = framing.crop_filter(
        track or framing.Track("center", 0, 0, [], []), w, h, render.out_ms - render.in_ms)
    fg = f"[0:v]{_shift(commands, sendcmd_path, render.in_ms)}{crop},scale={w}:-2:flags=lanczos[fg]"
    chain = [
        f"[0:v]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:2[bg]",
        fg,
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[base]",
    ]
    last = _overlays(render, workdir, chain, w, h)
    args = ["-ss", f"{render.in_ms / 1000:.3f}", "-t", f"{dur_s:.3f}", "-i", str(render.source),
            "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", "0:a?"]
    if render.loudnorm:
        args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    args += _encode_args(render)
    args.append(str(render.out))
    return args, sendcmd_path


def _split_stack(render: Render, workdir: Path, cells: list[str]) -> tuple[list[str], Path]:
    """Split layout: each speaker gets their own cell, stacked top to bottom.

    One 9:16 window cannot hold two people sitting apart — centring on both
    frames the gap between them. Each cell is cropped around its own face
    instead, so a two-person interview reads as two close-ups.
    """
    w, h = render.size
    dur_s = max(0.1, (render.out_ms - render.in_ms) / 1000)
    rows = len(cells)
    cell_h = max(2, (h // rows) - ((h // rows) % 2))
    chain = [f"[0:v]{crop},scale={w}:{cell_h}:flags=lanczos,setsar=1[cell{i}]"
             for i, crop in enumerate(cells)]
    chain.append("".join(f"[cell{i}]" for i in range(rows))
                 + f"vstack=inputs={rows},scale={w}:{h}:flags=lanczos,setsar=1[base]")
    last = _overlays(render, workdir, chain, w, h)
    args = ["-ss", f"{render.in_ms / 1000:.3f}", "-t", f"{dur_s:.3f}", "-i", str(render.source),
            "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", "0:a?"]
    if render.loudnorm:
        args += ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"]
    args += _encode_args(render)
    args.append(str(render.out))
    return args, workdir / "pan.cmd"


def _overlays(render: Render, workdir: Path, chain: list[str], w: int, h: int) -> str:
    """Append captions, title and watermark to a filter_complex graph.

    Takes the graph ending in [base] and returns the name of the last link, so
    the caller can map it.
    """
    last = "base"
    if render.finish_ass is not None:
        ass = workdir / "finish.ass"
        ass.write_text(render.finish_ass, encoding="utf-8")
        chain.append(f"[{last}]subtitles={ass.as_posix()}[finish]")
        return "finish"
    if render.captions_enabled and render.words:
        style = BY_ID.get(render.caption_style_id, BY_ID["bold_white"])
        ass = workdir / "captions.ass"
        ass.write_text(build_ass(render.words, style, w, h, censored=render.censored), encoding="utf-8")
        chain.append(f"[{last}]subtitles={ass.as_posix()}[cap]")
        last = "cap"
    for name, f in (("title", _title_filter(render.title or {}, w, h, workdir)),
                    ("mark", _watermark_filter(render.watermark or {}, w, h, workdir))):
        if f:
            chain.append(f"[{last}]{f}[{name}]")
            last = name
    return last


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
    media.ffmpeg(args)
    return render.out
