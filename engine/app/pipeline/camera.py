"""A camera that moves like a person is operating it.

The shot planner decides *what* each shot frames (whose face, which crop).
This module decides *how the frame moves* inside a shot, frame by frame:

- glides: when the subject changes mid-shot, the frame eases across instead
  of jumping (a real camera cut stays a cut); a moving subject is tracked
  with a smoothed path instead of stepping;
- breathing zoom: long shots slowly push in, every other one gently pulls
  out, anchored on the eyes so faces stay put while the frame breathes;
- punch-ins: a quick zoom on the moments the audio and the words say matter;
- the hook: a clip opens slightly tight and settles back.

It also chooses the transition between shots whose composition changes
without a camera cut. The result is written onto each Shot as `motion`
(per-frame crops) and `transition`, which the Engine's renderer, the editor's
live preview and the browser render all draw the same way.
"""
from __future__ import annotations

import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("engine.camera")

FPS = 30
#: How long a glide to a new subject takes: short hops are quick, big moves slower.
GLIDE_MIN_MS, GLIDE_MAX_MS = 380, 750
#: An operator sees the change before moving: the glide starts a beat after it.
REACT_MS = 90
#: A change this close to a camera cut is part of the cut: no glide.
CUT_SNAP_MS = 140
#: Samples this close together are a tracked path, smoothed rather than glided.
TRACK_STEP_MS = 160
#: The smoothing time constant for tracked paths.
TRACK_TAU_MS = 260

PUSH_MIN_SHOT_MS = 2500
PUSH_MIN, PUSH_MAX = 0.03, 0.06
PUNCH_GAIN = 0.12
PUNCH_ATTACK_MS, PUNCH_HOLD_MS, PUNCH_RELEASE_MS = 180, 420, 650
PUNCH_GAP_MS = 3500
PUNCH_EVERY_MS = 7000
PUNCH_CLEAR_START_MS, PUNCH_CLEAR_END_MS = 600, 500
HOOK_GAIN, HOOK_MS = 0.07, 1400
#: Never zoom so far that the crop is less than this share of the planned window.
MAX_EXTRA_ZOOM = 1.25
#: Zoom pivots on the eyes: this far down the window.
EYE_LINE = 0.36

TRANSITION_MS = 200
#: Words that carry stress in speech, for punch-ins.
EMPHASIS = re.compile(
    r"^(never|always|huge|insane|crazy|incredible|biggest|best|worst|love|hate|exactly|absolutely|"
    r"literally|seriously|massive|everything|nothing|nobody|everyone|must|need|important|truth|"
    r"secret|wrong|right|amazing|unbelievable|million|billion|free|now|stop|why|what)\W*$", re.I)


def ease_in_out(u: float) -> float:
    """Cubic ease in and out: slow off the mark, fast through the middle, soft landing."""
    u = min(1.0, max(0.0, u))
    return 4 * u * u * u if u < 0.5 else 1 - (-2 * u + 2) ** 3 / 2


def ease_out(u: float) -> float:
    u = min(1.0, max(0.0, u))
    return 1 - (1 - u) ** 3


# ------------------------------------------------------------------ the x path

def glide_ms(distance_px: float, window_w: float) -> int:
    """How long a move of `distance_px` takes: a tenth of the frame is quick, a whole frame slower."""
    share = min(1.0, abs(distance_px) / max(1.0, window_w))
    return int(GLIDE_MIN_MS + (GLIDE_MAX_MS - GLIDE_MIN_MS) * min(1.0, share * 1.6))


def centre_path(samples: list[tuple[int, float]], cuts: list[int], window_w: float):
    """The frame's centre over a shot as a function of ms, from the planner's samples.

    Each sample is where the planner wants the centre from that moment on.
    Changes at a camera cut jump; others glide. Dense samples (a tracked,
    moving subject) are smoothed with a critically damped follow instead.
    """
    if not samples:
        return lambda ms: 0.0
    samples = sorted(samples)
    dense = len(samples) > 3 and all(b[0] - a[0] <= TRACK_STEP_MS for a, b in zip(samples[1:], samples[2:]))
    if dense:
        return _smoothed(samples)
    moves: list[tuple[int, int, float, float]] = []      # (start, length, from, to)

    def at(ms: float, upto: int | None = None) -> float:
        x = samples[0][1]
        for start, length, a, b in moves[:upto]:
            if ms < start:
                break
            # Each move starts from wherever the frame was, so a new move that
            # begins before the last one landed carries on without a kink.
            x = b if length == 0 or ms >= start + length else a + (b - a) * ease_in_out((ms - start) / length)
        return x

    target_now = samples[0][1]
    for ms, target in samples[1:]:
        if abs(target - target_now) < 1:
            continue
        if any(abs(ms - c) <= CUT_SNAP_MS for c in cuts):
            moves.append((ms, 0, target, target))
        else:
            start = ms + REACT_MS
            moves.append((start, glide_ms(target - target_now, window_w), at(start, len(moves)), target))
        target_now = target

    return at


def _smoothed(samples: list[tuple[int, float]]):
    """A tracked path, followed like a camera on a fluid head (no steps, no overshoot)."""
    t0 = samples[0][0]
    t1 = samples[-1][0] + 2000
    step = 1000 / FPS
    out: list[tuple[float, float]] = []
    x = samples[0][1]
    v = 0.0
    i = 0
    ms = float(t0)
    # Critically damped spring towards the latest target.
    omega = 2.0 / (TRACK_TAU_MS / 1000)
    while ms <= t1:
        while i + 1 < len(samples) and samples[i + 1][0] <= ms:
            i += 1
        target = samples[i][1]
        dt = step / 1000
        f = 1 + 2 * dt * omega
        oo = omega * omega
        hoo = dt * oo
        hhoo = dt * hoo
        det_inv = 1 / (f + hhoo)
        det_x = f * x + dt * v + hhoo * target
        det_v = v + hoo * (target - x)
        x, v = det_x * det_inv, det_v * det_inv
        out.append((ms, x))
        ms += step

    def at(q: float) -> float:
        if q <= out[0][0]:
            return out[0][1]
        k = min(len(out) - 1, int((q - out[0][0]) / step))
        return out[k][1]

    return at


# ------------------------------------------------------------------ the zoom

@dataclass
class Punch:
    ms: int           # clip-relative start
    gain: float = PUNCH_GAIN


def zoom_at(rel_ms: float, shot_rel: tuple[int, int], index: int, punches: list[Punch],
            hook: bool, breathe: bool = True) -> float:
    """The extra zoom (>= 1) at a clip-relative time, inside one shot."""
    a, b = shot_rel
    length = b - a
    z = 1.0
    if breathe and length >= PUSH_MIN_SHOT_MS:
        amount = min(PUSH_MAX, max(PUSH_MIN, 0.0045 * length / 1000))
        u = (rel_ms - a) / length
        # Every other shot pulls out instead, so long stretches never feel mechanical.
        z += amount * (ease_in_out(u) if index % 2 == 0 else 1 - ease_in_out(u))
    for p in punches:
        d = rel_ms - p.ms
        if d < 0 or d > PUNCH_ATTACK_MS + PUNCH_HOLD_MS + PUNCH_RELEASE_MS:
            continue
        if d < PUNCH_ATTACK_MS:
            k = ease_out(d / PUNCH_ATTACK_MS)
        elif d < PUNCH_ATTACK_MS + PUNCH_HOLD_MS:
            k = 1.0
        else:
            k = 1 - ease_in_out((d - PUNCH_ATTACK_MS - PUNCH_HOLD_MS) / PUNCH_RELEASE_MS)
        z += p.gain * k
    if hook and rel_ms < HOOK_MS:
        z += HOOK_GAIN * (1 - ease_out(rel_ms / HOOK_MS))
    return min(MAX_EXTRA_ZOOM, z)


#: Loudness already read, by (source, size, mtime, range): the editor asks for a
#: clip's plan in every layout, and each would otherwise decode the audio again.
_LOUD: dict = {}


def loudness(source: Path, in_ms: int, out_ms: int, step_ms: int = 100) -> list[float]:
    """RMS loudness per `step_ms` of [in_ms, out_ms), from 8 kHz mono audio. Empty if unreadable."""
    try:
        st = Path(source).stat()
        key = (str(source), st.st_size, int(st.st_mtime), in_ms, out_ms, step_ms)
    except OSError:
        key = None
    if key in _LOUD:
        return _LOUD[key]
    env = _read_loudness(source, in_ms, out_ms, step_ms)
    if key is not None:
        if len(_LOUD) > 64:
            _LOUD.pop(next(iter(_LOUD)))
        _LOUD[key] = env
    return env


def _read_loudness(source: Path, in_ms: int, out_ms: int, step_ms: int) -> list[float]:
    try:
        import numpy as np

        from .. import media

        cmd = [media._bin("ffmpeg"), "-v", "quiet", "-ss", f"{in_ms / 1000:.3f}", "-t", f"{max(0.1, (out_ms - in_ms) / 1000):.3f}",
               "-i", str(source), "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]
        raw = subprocess.run(cmd, capture_output=True, timeout=120).stdout
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
        n = int(8000 * step_ms / 1000)
        if len(pcm) < n:
            return []
        frames = pcm[: len(pcm) // n * n].reshape(-1, n)
        return [float(v) for v in np.sqrt((frames * frames).mean(axis=1))]
    except Exception as e:  # noqa: BLE001 - without audio there are just no punch-ins
        log.warning("couldn't read the clip's loudness: %s", e)
        return []


def punch_moments(words: list[dict], env: list[float], length_ms: int, shots_rel: list[tuple[int, int]],
                  step_ms: int = 100) -> list[Punch]:
    """The moments worth a punch-in: words said clearly louder than the clip's norm, or with stress.

    At most one every PUNCH_EVERY_MS on average, never closer than
    PUNCH_GAP_MS, and never right at the start or end of a shot (that is
    where cuts and transitions already move the eye).
    """
    if not words:
        return []
    med = sorted(env)[len(env) // 2] if env else 0.0
    mad = sorted(abs(v - med) for v in env)[len(env) // 2] if env else 0.0
    scale = mad * 1.4826 or (med * 0.3) or 1.0

    def loud(a: int, b: int) -> float:
        if not env:
            return 0.0
        i, j = max(0, a // step_ms), min(len(env), max(a // step_ms + 1, b // step_ms + 1))
        return (max(env[i:j]) - med) / scale if i < j else 0.0

    def clear(ms: int) -> bool:
        for a, b in shots_rel:
            if a <= ms < b:
                return ms - a >= PUNCH_CLEAR_START_MS and b - ms >= PUNCH_CLEAR_END_MS + PUNCH_ATTACK_MS
        return False

    scored: list[tuple[float, int]] = []
    for w in words:
        a, b = int(w.get("start_ms", 0)), int(w.get("end_ms", 0))
        text = str(w.get("text", "")).strip()
        if not text or b <= a or not clear(a):
            continue
        cue = 1.0 if EMPHASIS.match(text) else 0.0
        cue += 0.8 if text.endswith("!") else 0.0
        cue += 0.6 if (len(text) > 2 and text.isupper()) else 0.0
        cue += 0.4 if re.search(r"\d", text) else 0.0
        z = loud(a, b)
        score = 0.75 * z + 0.9 * cue
        if z > 1.6 or (cue >= 1.0 and z > 0.2) or score > 1.8:
            scored.append((score, a))
    budget = max(1, length_ms // PUNCH_EVERY_MS)
    chosen: list[int] = []
    for _score, ms in sorted(scored, reverse=True):
        if len(chosen) >= budget:
            break
        if all(abs(ms - c) >= PUNCH_GAP_MS for c in chosen):
            chosen.append(ms)
    return [Punch(ms) for ms in sorted(chosen)]


# ------------------------------------------------------------------ transitions

#: Into a composition from another one, when the camera didn't cut.
def transition_for(prev_kind: str, kind: str, prev_zoom: float, zoom: float) -> str | None:
    """The ffmpeg xfade name for a change of composition (None: keep a straight cut)."""
    if prev_kind == kind == "fill":
        if abs(zoom - prev_zoom) < 0.04:
            return None
        return "zoomin" if zoom > prev_zoom else "fade"
    if kind in {"split", "grid"}:
        return "smoothup"
    if prev_kind in {"split", "grid"} and kind == "fill":
        return "zoomin"
    if kind == "pip":
        return "circleopen"
    if prev_kind == "pip":
        return "circleclose"
    if kind == "screen" or prev_kind == "screen":
        return "smoothup"
    return "fade"


# ------------------------------------------------------------------ putting it on the shots

def apply(shots_: list, inp, source: Path | None = None) -> list:
    """Give every shot its per-frame motion and its transition in. Returns the same list."""
    if not shots_:
        return shots_
    zoom_on = getattr(inp, "zoom", "auto") != "off"
    # "moments" already cuts to a tighter shot on each line; punch-ins on top would double up.
    punch_on = getattr(inp, "zoom", "auto") == "auto"
    in_ms, out_ms = inp.in_ms, inp.out_ms
    rel = [(s.start_ms - in_ms, s.end_ms - in_ms) for s in shots_]
    punches: list[Punch] = []
    if punch_on and source is not None:
        env = loudness(source, in_ms, out_ms)
        punches = punch_moments(list(inp.words or []), env, out_ms - in_ms, rel)
    cuts = list(getattr(inp, "cuts", []) or [])
    fill_index = 0
    for i, shot in enumerate(shots_):
        prev = shots_[i - 1] if i else None
        shot.transition = None
        if prev is not None and not any(abs(shot.start_ms - c) <= CUT_SNAP_MS for c in cuts):
            if min(shot.length_ms, prev.length_ms) >= 3 * TRANSITION_MS:
                shot.transition = transition_for(prev.kind, shot.kind, prev.zoom, shot.zoom)
        if shot.kind == "fill" or (shot.kind == "pip" and shot.base == "fill"):
            shot.motion = _fill_motion(shot, inp, cuts, punches, rel[i], fill_index, hook=(i == 0 and zoom_on), zoom_on=zoom_on)
            fill_index += 1
        else:
            shot.motion = []
    return shots_


def _fill_motion(shot, inp, cuts, punches, shot_rel, index, *, hook: bool, zoom_on: bool) -> list[tuple]:
    """Per-frame crops (source ms, x, y, w, h) for a shot that frames a person.

    Positions and sizes are sub-pixel (two decimals): the renderer samples
    between pixels, so a slow push-in glides instead of stepping a pixel at a time.
    """
    win = shot.window
    if win is None:
        return []
    sw, sh = inp.width, inp.height
    ww, wh = win.w, win.h
    samples = [(ms, x + ww / 2) for ms, x in (shot.pan or [(shot.start_ms, win.x)])]
    cx_at = centre_path(samples, cuts, ww)
    eye_y = win.y + wh * EYE_LINE
    # Run a transition's worth past each end, so a cross-fade has real frames to show.
    a, b = shot.start_ms - TRANSITION_MS // 2, shot.end_ms + TRANSITION_MS // 2
    step = 1000 / FPS
    out: list[tuple] = []
    ms = float(a)
    shot_punches = [p for p in punches if shot_rel[0] <= p.ms < shot_rel[1]]
    while ms < b:
        z = zoom_at(ms - inp.in_ms, shot_rel, index, shot_punches, hook, breathe=zoom_on) if zoom_on else 1.0
        w = min(float(sw), ww / z)
        h = min(float(sh), wh / z)
        cx = cx_at(min(max(ms, shot.start_ms), shot.end_ms))
        # Zoom pivots on the eye line, so the face stays where it was.
        x = max(0.0, min(sw - w, cx - w / 2))
        y = max(0.0, min(sh - h, eye_y - (eye_y - win.y) * (h / wh)))
        out.append((int(round(ms)), round(x, 2), round(y, 2), round(w, 2), round(h, 2)))
        ms += step
    return out

