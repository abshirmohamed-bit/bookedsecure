"""Who is actually speaking, from the picture and the sound together.

Detecting a face is not the same as knowing who is talking. The engine could
see two people and had no way to tell which one the audio belonged to, so a
clip of a host listening looked exactly like a clip of the host answering.

Two signals, neither convincing alone, are convincing together:

  * the mouth region of a face moves while that person talks, and
  * the audio is loud at the same moments.

A face whose mouth moves in time with the speech is the speaker. A face that
holds still through it is listening. A mouth that moves through silence —
chewing, laughing, nodding — scores nothing, because the score only counts
motion during speech.

This is deliberately not a neural active-speaker model. Those want a GPU and
a licence; this runs in the decode pass the engine already makes, which is
what a machine that sleeps between clips can afford.

Nothing here decides a layout. It reports who is speaking and how sure it is,
and leaves the composition to the caller.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

#: How often faces are detected. Detection is the expensive part.
DETECT_MS = 500
#: How often mouths are measured. Speech moves a mouth several times a second,
#: so this has to be finer than detection; between detections a track keeps
#: its last box, which is accurate enough over a tenth of a second.
MOTION_FPS = 10
#: Mouth region, as a share of the face box: centred horizontally, below the
#: middle, about half as wide as the face.
MOUTH = (0.00, 0.22, 0.55, 0.33)      # dx, dy, w, h relative to the face
#: A detection joins an existing track if it is no further than this (a share
#: of frame width) from where that track last was.
LINK_DISTANCE = 0.10
#: A track survives this long without a detection before it is closed, so a
#: head turn or a hand across the face does not start a new person.
TRACK_GAP_MS = 1500
#: A whole frame changing this much at once is a camera cut rather than
#: anything moving inside the shot. Measured in grey levels, 0..255.
CUT_MIN_DIFF = 18.0
#: And this many times the recent normal. Both have to hold: a dark clip
#: changes by little in absolute terms, a busy one changes a lot all the time.
CUT_FACTOR = 4.0


@dataclass
class FaceTrack:
    """One person, followed through the clip."""
    id: int
    #: (ms, (centre_x, centre_y, w, h)) — all 0..1 of the frame.
    boxes: list[tuple[int, tuple[float, float, float, float]]] = field(default_factory=list)
    #: (ms, how much the mouth region changed since the previous frame)
    motion: list[tuple[int, float]] = field(default_factory=list)

    @property
    def first_ms(self) -> int:
        return self.boxes[0][0] if self.boxes else 0

    @property
    def last_ms(self) -> int:
        return self.boxes[-1][0] if self.boxes else 0

    def box_at(self, ms: int) -> tuple[float, float, float, float] | None:
        if not self.boxes:
            return None
        return min(self.boxes, key=lambda b: abs(b[0] - ms))[1]

    def visible_at(self, ms: int, slack_ms: int = TRACK_GAP_MS) -> bool:
        return any(abs(b[0] - ms) <= slack_ms for b in self.boxes)

    @property
    def share(self) -> float:
        """How much of the clip this person was on screen for."""
        return float(len(self.boxes))


@dataclass
class Turn:
    """A stretch of the clip, and who was talking through it."""
    start_ms: int
    end_ms: int
    #: The track that was speaking, or None when nobody could be named.
    track_id: int | None
    #: 0..1. Low means the evidence did not separate the people, and the
    #: caller should prefer a composition that does not have to choose.
    confidence: float
    #: Why, when there is no track: "silence" (nobody is talking),
    #: "overlap" (more than one mouth is plainly going), "unseen" (someone is
    #: talking but no face here accounts for it — turned away, off camera).
    #: These want different layouts, so the difference is worth keeping.
    reason: str = "speaking"


def _mouth_patch(grey, box: tuple[float, float, float, float], size: int = 24):
    """The mouth region of one face, as a small brightness-normalised patch.

    Resized to a fixed size so a face near the camera and a face across the
    room produce comparable numbers, and with the mean taken out so a change
    in the lighting is not mistaken for a moving mouth.
    """
    import cv2
    import numpy as np

    fh, fw = grey.shape[:2]
    cx, cy, bw, bh = box
    dx, dy, mw, mh = MOUTH
    half_w = mw * bw * fw / 2
    half_h = mh * bh * fh / 2
    x0 = int((cx + dx) * fw - half_w)
    y0 = int((cy + dy * bh) * fh - half_h)
    x1 = int(x0 + half_w * 2)
    y1 = int(y0 + half_h * 2)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(fw, x1), min(fh, y1)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return None
    patch = cv2.resize(grey[y0:y1, x0:x1], (size, max(2, size * 2 // 3))).astype("float32")
    return patch - float(np.mean(patch))


def face_tracks(video: Path, *, in_ms: int = 0, out_ms: int | None = None,
                detect_ms: int = DETECT_MS, fps: int = MOTION_FPS,
                ) -> tuple[list[FaceTrack], list[int]]:
    """Follow each person through the clip, measuring their mouth as we go.

    One decode pass. Faces are detected a couple of times a second — that is
    the slow part — and the mouths are measured on every frame in between,
    each track keeping the last box it was seen at. Over a tenth of a second
    a head does not move far enough for that to matter.

    Camera cuts are found in the same pass and matter twice over. A face in
    the new shot is a different person from the face standing in the same
    place in the old one, so tracks must not reach across a cut. And the
    whole frame changing at once looks, to a mouth, exactly like a mouth
    moving — so no motion is measured across one either.

    Returns the people and the times they were cut between.
    """
    import cv2
    import numpy as np

    from .. import media
    from ..config import settings
    from .frame import _detector

    name, detect = _detector()
    if detect is None:
        return [], []

    from tempfile import TemporaryDirectory
    with TemporaryDirectory(prefix="speaker-") as directory:
        proxy = Path(directory) / "proxy.mp4"
        span = max(1, (out_ms if out_ms is not None else 0) - in_ms)
        args = ["-ss", f"{in_ms / 1000:.3f}"]
        if out_ms is not None:
            args += ["-t", f"{span / 1000:.3f}"]
        media.ffmpeg([*args, "-i", str(video), "-an", "-vf", f"scale=480:-2,fps={fps}",
                      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", str(proxy)],
                     timeout=600)

        cv2.setNumThreads(settings().worker_threads())
        cap = cv2.VideoCapture(str(proxy))
        if not cap.isOpened():
            return [], []
        step = max(1, int(round(fps * detect_ms / 1000)))
        tracks: list[FaceTrack] = []
        last_patch: dict[int, object] = {}
        last_box: dict[int, tuple] = {}
        cuts: list[int] = []
        recent: list[float] = []
        previous = None
        since = in_ms
        index = -1
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            index += 1
            ms = int(index / fps * 1000) + in_ms
            grey = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

            if previous is not None and previous.shape == grey.shape:
                change = float(np.mean(np.abs(grey.astype("float32")
                                              - previous.astype("float32"))))
                usual = float(np.median(recent)) if recent else change
                if change > max(CUT_MIN_DIFF, CUT_FACTOR * usual) and recent:
                    cuts.append(ms)
                    since = ms              # nobody from the old shot carries over
                    last_patch.clear()      # and no mouth is measured across it
                    last_box.clear()
                recent.append(change)
                if len(recent) > 25:
                    recent.pop(0)
            previous = grey

            if index % step == 0:
                fh, fw = bgr.shape[:2]
                found = detect(bgr) or []
                boxes = [((x + w / 2) / fw, (y + h / 2) / fh, w / fw, h / fh)
                         for x, y, w, h in found]
                _link(tracks, boxes, ms, since=since)

            for t in tracks:
                if ms - t.last_ms > TRACK_GAP_MS or t.last_ms < since:
                    continue
                box = t.box_at(ms)
                if box is None:
                    continue
                patch = _mouth_patch(grey, box)
                if patch is None:
                    continue
                before = last_patch.get(t.id)
                # Every re-detection nudges the box, which moves the window we
                # are cutting the mouth out of. Two patches taken from
                # different places are not comparable — the difference between
                # them is the box moving, not the mouth, and it measures as
                # large as real speech. Re-seed on those frames instead.
                moved = last_box.get(t.id) != box
                if before is not None and not moved \
                        and getattr(before, "shape", None) == patch.shape:
                    t.motion.append((ms, float(np.mean(np.abs(patch - before)))))
                last_patch[t.id] = patch
                last_box[t.id] = box
        cap.release()
    # Someone glimpsed for a moment is not a participant.
    return [t for t in tracks if len(t.boxes) >= 2], cuts


def _link(tracks: list[FaceTrack], boxes: list[tuple[float, float, float, float]],
          ms: int, *, since: int = 0) -> None:
    """Attach this frame's detections to the people already being followed.

    Nearest open track wins, one detection each. A detection that matches
    nobody starts a new person; a track nobody matched simply goes unseen for
    this frame and waits, which is what a head turning away looks like.
    """
    # A track from before the last cut is not a candidate: whoever stands
    # there now is someone else.
    open_tracks = [t for t in tracks
                   if ms - t.last_ms <= TRACK_GAP_MS and t.last_ms >= since]
    taken: set[int] = set()
    for box in boxes:
        best, best_d = None, LINK_DISTANCE
        for t in open_tracks:
            if t.id in taken:
                continue
            was = t.boxes[-1][1]
            d = abs(was[0] - box[0]) + abs(was[1] - box[1]) * 0.5
            if d < best_d:
                best, best_d = t, d
        if best is None:
            best = FaceTrack(id=len(tracks) + 1)
            tracks.append(best)
            open_tracks.append(best)
        taken.add(best.id)
        best.boxes.append((ms, box))


def energy(video: Path, *, in_ms: int = 0, out_ms: int | None = None,
           window_ms: int = 1000 // MOTION_FPS) -> list[tuple[int, float]]:
    """Loudness per window over the clip range, as (ms, rms).

    media.loudness_envelope walks the samples in Python and reads the whole
    file; this needs only the clip, at ten windows a second, so it cuts the
    range in ffmpeg and sums in numpy.
    """
    import wave
    from tempfile import TemporaryDirectory

    import numpy as np

    from .. import media

    with TemporaryDirectory(prefix="energy-") as directory:
        wav = Path(directory) / "a.wav"
        args = ["-ss", f"{in_ms / 1000:.3f}"]
        if out_ms is not None:
            args += ["-t", f"{max(1, out_ms - in_ms) / 1000:.3f}"]
        try:
            media.ffmpeg([*args, "-i", str(video), "-vn", "-ac", "1", "-ar", "8000",
                          "-c:a", "pcm_s16le", str(wav)], timeout=600)
            with wave.open(str(wav), "rb") as w:
                rate = w.getframerate()
                raw = w.readframes(w.getnframes())
        except Exception:
            return []                      # a clip with no audio is not a failure
    if not raw:
        return []
    samples = np.frombuffer(raw, dtype="<i2").astype("float32")
    step = max(1, int(rate * window_ms / 1000))
    usable = (len(samples) // step) * step
    if usable < step:
        return []
    blocks = samples[:usable].reshape(-1, step)
    rms = np.sqrt((blocks * blocks).mean(axis=1))
    return [(in_ms + i * window_ms, float(v)) for i, v in enumerate(rms)]


#: Below this the clip is room tone, not speech. 16-bit samples, so silence
#: sits near zero and even a quiet room reads well above it.
SILENT_RMS = 40.0
#: A clip whose loudness varies less than this across its range never pauses.
FLAT_RANGE = 0.15


def _speech_mask(rms: list[tuple[int, float]]):
    """Which windows carry speech rather than room tone.

    The threshold is taken from the clip itself: quiet rooms and loud studios
    have nothing in common but the gap between their own silence and their
    own speech.
    """
    import numpy as np

    if not rms:
        return None, None
    times = np.array([t for t, _ in rms])
    values = np.array([v for _, v in rms], dtype="float64")
    floor = float(np.percentile(values, 20))
    ceiling = float(np.percentile(values, 95))
    if ceiling < SILENT_RMS:
        # Nothing but room tone from end to end.
        return times, np.zeros(len(values), dtype=bool)
    if ceiling - floor < FLAT_RANGE * ceiling:
        # Loud throughout, with nothing resembling a pause. Splitting a level
        # signal at some percentile would invent quiet moments that are not
        # there, and anything measured "during the silence" would really be
        # measured during the talking.
        return times, np.ones(len(values), dtype=bool)
    return times, values > floor + 0.25 * (ceiling - floor)


#: A turn has to last this long to be worth cutting to. Below it the layout
#: would flick between people on every "mm-hm".
MIN_TURN_MS = 1200
#: How far ahead the winner must be to be called.
MIN_MARGIN = 0.15
#: A mouth at this level is plainly going, measured against the liveliest
#: mouth in the clip. If the RUNNER-UP is also this active then two people
#: are talking over each other, and naming one of them would be a guess
#: dressed up as an answer — the margin alone does not catch this, because
#: one of two talkers is usually a little ahead of the other.
OVERLAP_LEVEL = 0.30
#: How far a mouth region must actually move before it counts as moving at
#: all, in grey levels. This one is ABSOLUTE on purpose. Everything else here
#: is measured against the liveliest mouth in the clip, which is what makes
#: it work across different faces and framings — but it also means that in a
#: clip where nobody's mouth moves, the encoder noise becomes the liveliest
#: mouth and gets stretched up to look exactly like speech. Talking measures
#: around 12; a still frame's noise around 1.
MIN_MOTION = 3.0


def turns(tracks: list[FaceTrack], rms: list[tuple[int, float]], *,
          window_ms: int = 600, min_turn_ms: int = MIN_TURN_MS) -> list[Turn]:
    """Who is speaking, window by window, merged into turns.

    A track scores for a window by how much its mouth moved *while the audio
    was loud*. Motion during silence earns nothing, which is what keeps a
    nodding listener or a laughing guest from being called the speaker.

    The answer is a track id only when one person is clearly ahead. Both
    talking, nobody facing the camera, or a face too small to read all come
    back as None with a low confidence — an honest "cannot tell", which the
    layout can answer with a composition that shows everyone.
    """
    import numpy as np

    times, speech = _speech_mask(rms)
    if times is None or speech is None or not tracks:
        return []
    span_start = int(times[0])
    span_end = int(times[-1])
    if span_end <= span_start:
        return []

    # Each face has its own noise floor — grain, compression, a slight sway —
    # so take that away before comparing. The floor is read from the moments
    # the room is QUIET, which is the only time we know a mouth should be
    # still. Taking it from the track's own low percentile instead looks
    # equivalent and is not: someone who talks right through the clip has no
    # low percentile to speak of, and subtracting it removes the very signal
    # being measured.
    quiet = ~speech
    residual = {}
    for t in tracks:
        if len(t.motion) < 3:
            continue
        m_times = np.array([ms for ms, _ in t.motion])
        m_values = np.array([v for _, v in t.motion], dtype="float64")
        still = np.interp(m_times, times, quiet.astype("float64")) > 0.5
        floor = float(np.median(m_values[still])) if int(still.sum()) >= 3 else 0.0
        residual[t.id] = (m_times, np.maximum(0.0, m_values - floor))
    if not residual:
        return []
    scale = max((float(np.percentile(v, 90)) for _, v in residual.values()), default=0.0)
    scale = max(scale, MIN_MOTION)
    series = residual

    out: list[Turn] = []
    for start in range(span_start, span_end, window_ms):
        end = min(span_end, start + window_ms)
        loud = speech[(times >= start) & (times < end)]
        if not loud.size or not loud.any():
            out.append(Turn(start, end, None, 0.0, "silence"))
            continue
        scores: list[tuple[float, int]] = []
        for tid, (m_times, m_values) in series.items():
            inside = (m_times >= start) & (m_times < end)
            if not inside.any():
                continue
            # Only motion that coincides with speech counts.
            speaking = np.interp(m_times[inside], times, speech.astype("float64")) > 0.5
            if not speaking.any():
                continue
            scores.append((float(m_values[inside][speaking].mean()), tid))
        if not scores:
            out.append(Turn(start, end, None, 0.0, "unseen"))
            continue
        scores.sort(reverse=True)
        top, tid = scores[0]
        runner = scores[1][0] if len(scores) > 1 else 0.0
        margin = (top - runner) / (top + runner) if (top + runner) > 0 else 0.0
        # Raw for "did anything move", scaled for "who moved most".
        runner_level = runner / scale
        if top < MIN_MOTION:
            out.append(Turn(start, end, None, round(margin, 3), "unseen"))
        elif runner_level >= OVERLAP_LEVEL:
            out.append(Turn(start, end, None, round(margin, 3), "overlap"))
        elif margin < MIN_MARGIN:
            out.append(Turn(start, end, None, round(margin, 3), "overlap"))
        else:
            out.append(Turn(start, end, tid, round(margin, 3), "speaking"))

    return _merge(out, min_turn_ms)


def _coalesce(windows: list[Turn]) -> list[Turn]:
    """Join neighbouring stretches that say the same thing."""
    out: list[Turn] = []
    for w in windows:
        if out and w.track_id == out[-1].track_id and w.reason == out[-1].reason:
            out[-1] = Turn(out[-1].start_ms, w.end_ms, out[-1].track_id,
                           max(out[-1].confidence, w.confidence), out[-1].reason)
        else:
            out.append(w)
    return out


def _merge(windows: list[Turn], min_turn_ms: int) -> list[Turn]:
    """Turn per-window answers into turns worth cutting to.

    Absorbing a flicker leaves the stretches either side of it adjacent and
    identical, so the join has to run again afterwards — otherwise one
    interjection splits a single answer into two turns for good.
    """
    if not windows:
        return []
    kept: list[Turn] = []
    for turn in _coalesce(windows):
        short = turn.end_ms - turn.start_ms < min_turn_ms
        if kept and short and turn.track_id != kept[-1].track_id:
            kept[-1] = Turn(kept[-1].start_ms, turn.end_ms, kept[-1].track_id,
                            kept[-1].confidence, kept[-1].reason)
        else:
            kept.append(turn)
    return _coalesce(kept)


def speaker_at(turns_: list[Turn], ms: int) -> Turn | None:
    """The turn covering this moment, or None if it falls outside them all."""
    for t in turns_:
        if t.start_ms <= ms < t.end_ms:
            return t
    return None


def focus(tracks: list[FaceTrack], turns_: list[Turn], *,
          fallback: list[tuple[int, float]], step_ms: int = 250,
          ) -> list[tuple[int, float]]:
    """Where the crop should look over time: at whoever is talking.

    The old answer was the average of every face on screen, which on a
    two-person interview is the gap between them — a crop centred on nobody.
    This aims at the speaker instead.

    The important case is the awkward one. When a speaker turns away, their
    face stops being detected, but they have not gone anywhere: the track
    keeps its last position, so the crop holds on them rather than wandering
    off to whoever happens to be facing the camera. Through silence or a
    scramble the crop simply holds still, because moving to nobody in
    particular is worse than staying put.
    """
    if not tracks or not turns_:
        return fallback
    by_id = {t.id: t for t in tracks}
    spans = [t for t in turns_ if t.track_id is not None]
    if not spans:
        return fallback
    start = min(t.start_ms for t in turns_)
    end = max(t.end_ms for t in turns_)
    picked: list[tuple[int, float]] = []
    held: float | None = None
    for ms in range(start, end, step_ms):
        turn = speaker_at(turns_, ms)
        who = by_id.get(turn.track_id) if turn and turn.track_id else None
        if who is not None:
            box = who.box_at(ms)
            if box is not None:
                held = box[0]
        if held is None:
            near = [x for t, x in fallback if abs(t - ms) <= step_ms * 2]
            if near:
                held = near[0]
        if held is not None:
            picked.append((ms, held))
    return picked or fallback


def panel_time(tracks: list[FaceTrack], turns_: list[Turn], seam: float) -> dict[int, int]:
    """How long each side of a composite's join held the speaker, in ms.

    A composite is two cameras, and whoever is talking belongs to one of them
    whether or not their face is turned to it at that moment. Totalling the
    speaking time per side says which feed the clip is actually about.
    """
    by_id = {t.id: t for t in tracks}
    out = {0: 0, 1: 0}
    for turn in turns_:
        if turn.track_id is None:
            continue
        who = by_id.get(turn.track_id)
        box = who.box_at(turn.start_ms) if who else None
        if box is None:
            continue
        out[0 if box[0] < seam else 1] += turn.end_ms - turn.start_ms
    return out


#: One feed has to hold this much of the named speaking time before the clip
#: is treated as being about that feed alone.
DOMINANT_SHARE = 0.75


def dominant_panel(tracks: list[FaceTrack], turns_: list[Turn], seam: float) -> int | None:
    """The one feed worth showing on its own, or None if the clip needs both.

    A guest answering at length is better as one big shot of their feed than
    as two half-height cells, one of which is a host sitting quietly. A
    back-and-forth needs both.
    """
    held = panel_time(tracks, turns_, seam)
    total = held[0] + held[1]
    if total <= 0:
        return None
    side = 0 if held[0] >= held[1] else 1
    return side if held[side] / total >= DOMINANT_SHARE else None
