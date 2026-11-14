"""Voice activity: where someone is actually speaking (Silero VAD, ONNX).

The loudness test (speaker._speech_mask) can't tell a voice from music: on a
music-only detailing clip it read 55-59% "speech" where Silero read 0%. So
the speech pass, the finder and the style review ask this module as well:

  * speaker.turns only counts mouth movement while a voice is heard, so
    someone moving to music is never "the speaker";
  * the finder drops transcript sentences with no voice under them (Whisper
    writes words over music) and picks from sound and picture when the
    soundtrack is music;
  * the style review and the camera use the clip's voiced share, so a music
    clip isn't "narrated" and gets no punch-ins on words nobody said.

The model is optional (SILERO_MODEL_PATH, fetched in the Dockerfile). Without
it, or when the audio can't be read, everything returns None and the Engine
works from loudness alone, exactly as before.
"""
from __future__ import annotations

import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path

log = logging.getLogger(__name__)

RATE = 16000
#: Silero v5 at 16 kHz: 512-sample chunks (32 ms) with 64 samples of context.
CHUNK = 512
CONTEXT = 64
STEP_MS = CHUNK * 1000 // RATE
#: A chunk is voiced at this probability.
VOICED = 0.5
#: Voice shorter than this is a cough or a click, not speech.
MIN_VOICE_MS = 250
#: Speech spans are padded this much each side (the edges of words are soft).
PAD_MS = 200
#: A sentence is kept when at least this share of it has a voice under it.
SENTENCE_MIN_VOICED = 0.25
#: Below this voiced share a clip or video counts as music or ambience.
MUSIC_SHARE = 0.08

_LOCK = threading.Lock()
_SESSION = None
_TRIED = False
_CACHE: "OrderedDict[tuple, list[tuple[int, float]] | None]" = OrderedDict()
CACHE_MAX = 16


def _session():
    global _SESSION, _TRIED
    with _LOCK:
        if _TRIED:
            return _SESSION
        _TRIED = True
        path = os.environ.get("SILERO_MODEL_PATH", "/models/silero_vad.onnx")
        if not Path(path).is_file():
            log.info("no voice model at %s; speech is told from loudness only", path)
            return None
        try:
            import onnxruntime as ort

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 1
            opts.inter_op_num_threads = 1
            _SESSION = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
        except Exception:  # noqa: BLE001 - optional model
            log.exception("voice model couldn't be loaded; speech is told from loudness only")
            _SESSION = None
        return _SESSION


def available() -> bool:
    return _session() is not None


class _Stream:
    """Silero over audio fed in blocks: the model's state and context carry across blocks."""

    def __init__(self, sess):
        import numpy as np

        self.np = np
        self.sess = sess
        self.state = np.zeros((2, 1, 128), np.float32)
        self.sr = np.array(RATE, dtype=np.int64)
        self.context = np.zeros(CONTEXT, np.float32)
        self.left = np.zeros(0, np.float32)

    def feed(self, samples) -> list[float]:
        np = self.np
        audio = np.concatenate([self.left, np.asarray(samples, dtype=np.float32)])
        out: list[float] = []
        whole = (len(audio) // CHUNK) * CHUNK
        for i in range(0, whole, CHUNK):
            chunk = audio[i:i + CHUNK]
            x = np.concatenate([self.context, chunk])[None, :]
            prob, self.state = self.sess.run(None, {"input": x, "state": self.state, "sr": self.sr})
            self.context = chunk[-CONTEXT:]
            out.append(float(prob.reshape(-1)[0]))
        self.left = audio[whole:]
        return out


def probabilities(samples) -> list[float]:
    """Voice probability per 32 ms chunk of 16 kHz mono float samples."""
    sess = _session()
    return _Stream(sess).feed(samples) if sess is not None else []


#: Audio is read and scored this many seconds at a time, so an hour-long
#: soundtrack never sits in memory whole.
BLOCK_S = 60


def _score_file(video: Path, in_ms: int, out_ms: "int | None") -> list[float]:
    import wave
    from tempfile import TemporaryDirectory

    import numpy as np

    from .. import media

    sess = _session()
    if sess is None:
        return []
    with TemporaryDirectory(prefix="vad-") as directory:
        wav = Path(directory) / "a.wav"
        args = ["-ss", f"{in_ms / 1000:.3f}"]
        if out_ms is not None:
            args += ["-t", f"{max(1, out_ms - in_ms) / 1000:.3f}"]
        media.ffmpeg([*args, "-i", str(video), "-vn", "-ac", "1", "-ar", str(RATE),
                      "-c:a", "pcm_s16le", str(wav)], timeout=900)
        stream = _Stream(sess)
        out: list[float] = []
        with wave.open(str(wav), "rb") as w:
            while True:
                raw = w.readframes(RATE * BLOCK_S)
                if not raw:
                    break
                out.extend(stream.feed(np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0))
    return out


def voiced(video: Path, *, in_ms: int = 0, out_ms: int | None = None) -> "list[tuple[int, float]] | None":
    """(ms, voice probability) every 32 ms over [in_ms, out_ms), or None when it can't be told."""
    if _session() is None:
        return None
    try:
        st = Path(video).stat()
        key = (str(video), st.st_mtime_ns, st.st_size, in_ms, out_ms)
    except OSError:
        return None
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    try:
        probs = _score_file(Path(video), in_ms, out_ms)
        result = [(in_ms + i * STEP_MS, p) for i, p in enumerate(probs)] if probs else None
    except Exception:  # noqa: BLE001 - advice only; loudness still works
        log.warning("couldn't read voice activity for %s", Path(video).name, exc_info=True)
        result = None
    with _LOCK:
        _CACHE[key] = result
        while len(_CACHE) > CACHE_MAX:
            _CACHE.popitem(last=False)
    return result


def spans(probs: "list[tuple[int, float]] | None", *, threshold: float = VOICED,
          min_ms: int = MIN_VOICE_MS, pad_ms: int = PAD_MS) -> list[tuple[int, int]]:
    """Stretches with a voice, as (start_ms, end_ms): short blips dropped, edges padded, overlaps joined."""
    if not probs:
        return []
    raw: list[tuple[int, int]] = []
    start = None
    for ms, p in probs:
        if p >= threshold and start is None:
            start = ms
        elif p < threshold and start is not None:
            raw.append((start, ms))
            start = None
    if start is not None:
        raw.append((start, probs[-1][0] + STEP_MS))
    out: list[tuple[int, int]] = []
    for a, b in raw:
        if b - a < min_ms:
            continue
        a, b = a - pad_ms, b + pad_ms
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def covered(voice: list[tuple[int, int]], a: int, b: int) -> float:
    """Share of [a, b) inside the voice spans."""
    if b <= a:
        return 0.0
    inside = sum(max(0, min(b, y) - max(a, x)) for x, y in voice)
    return min(1.0, inside / (b - a))


def share(probs: "list[tuple[int, float]] | None", in_ms: int, out_ms: int) -> "float | None":
    """Share of the range with a voice, or None when it can't be told."""
    if probs is None:
        return None
    return round(covered(spans(probs), in_ms, out_ms), 3)


def keep_spoken(sentences: list[dict], voice: list[tuple[int, int]]) -> list[dict]:
    """Transcript sentences with a voice under them (Whisper writes words over music too)."""
    return [x for x in sentences
            if covered(voice, int(x.get("start_ms", 0)), int(x.get("end_ms", 0))) >= SENTENCE_MIN_VOICED]


def mask(voice_spans: list[tuple[int, int]], times) -> "object":
    """A boolean array over `times` (ms): True inside a voice span."""
    import numpy as np

    t = np.asarray(times)
    out = np.zeros(len(t), dtype=bool)
    for a, b in voice_spans:
        out |= (t >= a) & (t < b)
    return out
