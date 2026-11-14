"""Voice activity: spans, shares and the sentences and turns it keeps.

The model itself is optional; these check the rules around it with made-up
probabilities, and that everything stands down to loudness without it.
"""
from __future__ import annotations

from app.pipeline import speaker as sp
from app.pipeline import vad
from app.pipeline.speaker import FaceTrack


def probs(pattern: str, start: int = 0):
    """'1' = voiced chunk, '0' = not, 32 ms each."""
    return [(start + i * vad.STEP_MS, 0.9 if c == "1" else 0.05) for i, c in enumerate(pattern)]


def test_spans_drop_blips_pad_edges_and_join():
    p = probs("0" * 10 + "1" * 20 + "0" * 5 + "1" * 20 + "0" * 30 + "1" * 3 + "0" * 10)
    out = vad.spans(p)
    # two voiced runs 5 chunks (160 ms) apart join once padded; the 96 ms blip is dropped
    assert len(out) == 1
    a, b = out[0]
    assert a == 10 * 32 - vad.PAD_MS and b == 55 * 32 + vad.PAD_MS


def test_share_and_covered():
    p = probs("1" * 50 + "0" * 50)          # 3.2 s of 6.4 s voiced
    s = vad.share(p, 0, 100 * 32)
    assert 0.5 <= s <= 0.6                   # padded at the end of the voice
    assert vad.share(None, 0, 1000) is None
    assert vad.covered([(0, 1000)], 500, 1500) == 0.5


def test_sentences_over_music_are_dropped():
    voice = [(0, 4000)]
    sentences = [{"start_ms": 500, "end_ms": 3000, "text": "Said."},
                 {"start_ms": 9000, "end_ms": 12000, "text": "Lyrics the transcriber heard."}]
    assert [x["text"] for x in vad.keep_spoken(sentences, voice)] == ["Said."]


def test_without_the_model_nothing_changes(monkeypatch, tmp_path):
    monkeypatch.setattr(vad, "_SESSION", None)
    monkeypatch.setattr(vad, "_TRIED", True)
    assert vad.voiced(tmp_path / "missing.mp4") is None
    assert vad.probabilities([0.0] * 2048) == []


def _talking_track(tid: int, x: float):
    """A face whose mouth moves all clip long (every 100 ms)."""
    t = FaceTrack(id=tid)
    for ms in range(0, 10000, 100):
        open_ = 0.02 if (ms // 100) % 2 else 0.0
        t.boxes.append((ms, (x, 0.4, 0.1, 0.12 + open_)))
    return t


def test_turns_only_count_motion_while_a_voice_is_heard():
    rms = [(ms, 3000.0 if (ms // 1000) % 2 == 0 else 200.0) for ms in range(0, 10000, 100)]
    tracks = [_talking_track(1, 0.5)]
    loud_only = sp.turns(tracks, rms)
    with_voice = sp.turns(tracks, rms, voice=[])           # music: loud, but no voice anywhere
    assert any(t.track_id == 1 for t in loud_only) or all(t.reason != "speaking" for t in loud_only)
    assert all(t.track_id is None for t in with_voice)
    assert all(t.reason == "silence" for t in with_voice)
