"""YouTube's "Most replayed" curve steers the finder towards what viewers rewatch."""
from __future__ import annotations

from app.pipeline import find, replay


def heat(duration_s: int, peaks: dict[int, float], base: float = 0.15):
    """100 yt-dlp heatmap buckets with a spike at the opening and the given peaks (second -> value)."""
    step = duration_s / 100
    out = []
    for i in range(100):
        a = i * step
        v = 1.0 if a < 6 else base
        for at, pv in peaks.items():
            if a <= at < a + step:
                v = pv
            elif abs(a + step / 2 - at) < step * 1.5:
                v = max(v, pv * 0.6)
        out.append({"start_time": a, "end_time": a + step, "value": v})
    return out


def sentences(duration_s: int, every: int = 5):
    return [{"start_ms": t * 1000, "end_ms": (t + every) * 1000 - 200, "text": f"Sentence at {t} seconds about things."}
            for t in range(0, duration_s - every, every)]


def test_the_opening_spike_is_never_a_peak_and_the_body_is_normalised():
    c = replay.Curve.from_heatmap(heat(600, {300: 0.6}), 600_000)
    peaks = c.peaks()
    assert peaks and abs(peaks[0][0] - 300_000) < 7000
    assert peaks[0][1] == 1.0                     # normalised to the body, not the opening
    assert all(ms > 20_000 for ms, _ in peaks)


def test_a_flat_curve_has_no_peaks():
    c = replay.Curve.from_heatmap(heat(600, {}, base=0.4), 600_000)
    assert c.peaks() == []
    assert replay.prompt_hint(c) == ""


def test_rerank_lifts_the_moment_viewers_replay():
    c = replay.Curve.from_heatmap(heat(600, {300: 0.9}), 600_000)
    a = find.Moment(100_000, 150_000, "A", 80.0)
    b = find.Moment(280_000, 330_000, "B", 70.0)
    replay.rerank([a, b], c)
    assert b.score > a.score
    assert "replay" in b.reason.lower()


def test_an_uncovered_strong_peak_gets_a_clip_on_sentence_boundaries():
    c = replay.Curve.from_heatmap(heat(600, {420: 0.95}), 600_000)
    s = sentences(600)
    picks = [find.Moment(60_000, 110_000, "A", 80.0), find.Moment(200_000, 250_000, "B", 75.0)]
    out = replay.cover_peaks(picks, c, s, 50_000, 2, lambda a, b, t: find.Moment(a, b, "new", 70.0))
    assert len(out) == 2
    new = [m for m in out if m.title == "new"]
    assert new and new[0].start_ms < 420_000 < new[0].end_ms
    assert new[0].start_ms in {x["start_ms"] for x in s} and new[0].end_ms in {x["end_ms"] for x in s}


def test_the_ai_is_told_where_viewers_rewatch():
    c = replay.Curve.from_heatmap(heat(600, {300: 0.9}), 600_000)
    hint = replay.prompt_hint(c)
    assert "5:0" in hint or "4:5" in hint
    prompt = find._claude_prompt(sentences(600)[:5], 3, 45_000, genre="auto", prompt="", must_include=[],
                                 coverage="best", keep_qa=True, viewer_hint=hint)
    assert "Most replayed" in prompt


def test_rules_finding_with_a_curve_covers_the_peak(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings(), "finder_provider", "rules", raising=False)
    monkeypatch.setattr(type(settings()), "resolve_finder", lambda self: "rules", raising=False)
    c = replay.Curve.from_heatmap(heat(600, {455: 1.0}), 600_000)
    got = find.find(sentences(600), count=3, target_ms=45_000, replay_curve=c)
    assert any(m.start_ms <= 455_000 < m.end_ms for m in got)


def test_is_youtube():
    assert replay.is_youtube("https://www.youtube.com/watch?v=x")
    assert replay.is_youtube("https://youtu.be/x")
    assert not replay.is_youtube("https://vimeo.com/1")
    assert not replay.is_youtube("https://evil.com/youtube.com")
