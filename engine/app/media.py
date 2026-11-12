"""Thin, well-behaved wrappers around ffmpeg/ffprobe."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path

from .errors import EngineError
from .config import settings

log = logging.getLogger("engine.media")

_slots: threading.BoundedSemaphore | None = None
_slots_lock = threading.Lock()


def _processing_slot() -> threading.BoundedSemaphore:
    """How many ffmpeg processes may run at once (FFMPEG_SLOTS).

    One at a time made the worker pools pointless: a long render held every
    other video's audio extract and proxy decode behind it.
    """
    global _slots
    with _slots_lock:
        if _slots is None:
            _slots = threading.BoundedSemaphore(max(1, settings().ffmpeg_slots))
        return _slots


def _bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise EngineError("NOT_CONFIGURED", f"{name} is not installed on this host.")
    return path


def run(args: list[str], timeout: int = 3600, cwd: Path | None = None) -> subprocess.CompletedProcess:
    proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, cwd=str(cwd) if cwd else None)
    if proc.returncode != 0:
        lines = (proc.stderr or "").strip().splitlines()
        log.error("ffmpeg exited %s: %s", proc.returncode, " | ".join(lines[-30:]))
        tail = lines[-4:]
        raise EngineError("VALIDATION_ERROR", "ffmpeg failed: " + " / ".join(tail))
    return proc


def ffmpeg(args: list[str], timeout: int = 3600, cwd: Path | None = None) -> subprocess.CompletedProcess:
    """Run ffmpeg. `cwd` lets a filter graph name its side files bare, which is
    the one spelling that needs no escaping on any platform."""
    threads = str(settings().worker_threads())
    bounded = []
    for arg in args:
        if arg == "-i":
            bounded.extend(["-threads", threads])
        bounded.append(arg)
    # Decoder options are per input; encoder options must precede the output.
    bounded[-1:-1] = ["-threads", threads]
    with _processing_slot():
        return run([_bin("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
                    "-filter_threads", threads, "-filter_complex_threads", threads, *bounded], timeout, cwd=cwd)


@dataclass
class Probe:
    duration_s: float
    width: int
    height: int
    fps: float
    size_bytes: int
    vcodec: str
    acodec: str
    has_audio: bool

    @property
    def needs_mezzanine(self) -> bool:
        """Re-encode only when seeking would otherwise be unreliable."""
        return self.vcodec not in {"h264"} or (self.has_audio and self.acodec not in {"aac"})


def probe(path: Path) -> Probe:
    out = run([
        _bin("ffprobe"), "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", str(path),
    ], timeout=120).stdout
    data = json.loads(out)
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not v:
        raise EngineError("UNSUPPORTED_MEDIA_TYPE", "That file has no video track.")
    fps = 0.0
    raw = v.get("r_frame_rate", "0/1")
    if "/" in raw:
        num, den = raw.split("/", 1)
        fps = float(num) / float(den) if float(den) else 0.0
    width, height = int(v.get("width", 0)), int(v.get("height", 0))
    # a rotated phone video reports its pre-rotation size
    rotation = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = abs(int(sd["rotation"])) % 360
    if rotation in (90, 270):
        width, height = height, width
    return Probe(
        duration_s=float(data.get("format", {}).get("duration") or v.get("duration") or 0.0),
        width=width, height=height, fps=fps,
        size_bytes=int(data.get("format", {}).get("size") or path.stat().st_size),
        vcodec=v.get("codec_name", ""), acodec=(a or {}).get("codec_name", ""),
        has_audio=a is not None,
    )


def thumbnail(src: Path, dest: Path, at_s: float, width: int = 640) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg(["-ss", f"{max(0.0, at_s):.3f}", "-i", str(src), "-frames:v", "1",
            "-vf", f"scale={width}:-2", "-q:v", "3", str(dest)], timeout=180)
    return dest


def make_mezzanine(src: Path, dest: Path, fps: float = 30.0) -> Path:
    """Normalise to H.264/AAC at constant frame rate, at the SOURCE resolution.

    Never downscale: a 4K source stays 4K so a 9:16 crop out of it is still sharp.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg([
        "-i", str(src), "-r", f"{fps:g}",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(dest),
    ])
    return dest


#: Codecs ffmpeg seeks reliably once they are in an indexed mp4. A source in
#: one of these never needs re-encoding on the way in.
COPYABLE = {"h264", "hevc", "vp9", "av1"}


def remux_copy(src: Path, dest: Path) -> Path:
    """Keep the video bit-for-bit; normalise the audio and container only.

    FFmpeg decodes the retained source when rendering individual clips, so a
    long 4K import need not first encode every frame into another 4K video.
    Encoding a whole source is minutes of work; this is seconds.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart", str(dest)])
    return dest


#: The name this arrived under. AV1 was the first codec it was needed for.
remux_av1 = remux_copy


def extract_audio(src: Path, dest: Path, rate: int = 16000) -> Path:
    """16 kHz mono wav: what speech recognition wants."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le", str(dest)], timeout=1800)
    return dest


def cut(src: Path, dest: Path, in_ms: int, out_ms: int) -> Path:
    """Frame-accurate cut by re-encoding from the mezzanine."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dur = max(0.05, (out_ms - in_ms) / 1000)
    ffmpeg([
        "-ss", f"{in_ms / 1000:.3f}", "-i", str(src), "-t", f"{dur:.3f}",
        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", str(dest),
    ])
    return dest


def loudness_envelope(src: Path, window_ms: int = 500) -> list[float]:
    """Mean volume per window — the basis of energy mode and zoom timing."""
    import math
    import wave

    import uuid

    # Unique per call: two jobs on one source run side by side.
    wav = src.with_name(f"{src.stem}.{uuid.uuid4().hex[:8]}.env.wav")
    extract_audio(src, wav, rate=8000)
    with wave.open(str(wav), "rb") as w:
        frames = w.readframes(w.getnframes())
        rate = w.getframerate()
    wav.unlink(missing_ok=True)
    step = int(rate * window_ms / 1000)
    out: list[float] = []
    for i in range(0, len(frames) // 2, step):
        chunk = frames[i * 2 : (i + step) * 2]
        if not chunk:
            break
        total = 0
        count = len(chunk) // 2
        for j in range(0, len(chunk) - 1, 2):
            s = int.from_bytes(chunk[j : j + 2], "little", signed=True)
            total += s * s
        out.append(math.sqrt(total / count) if count else 0.0)
    return out
