"""Reading a link before committing to it — what the dashboard's URL bar needs."""
from __future__ import annotations

import pytest

from app.errors import EngineError
from app.pipeline.analyze import UrlInfo, _friendly, analyze, quality_label


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings(), "analyze_provider", "fake", raising=False)


def test_a_link_is_read_without_downloading_it():
    info = analyze("https://www.youtube.com/watch?v=abc123")
    assert info.title and info.duration_ms > 0
    assert info.thumbnail_url, "the dashboard shows a thumbnail before any work starts"


def test_metadata_lookup_does_not_require_a_downloadable_format(monkeypatch):
    import sys
    from types import SimpleNamespace
    from app.pipeline.analyze import _ytdlp
    seen = {}

    class Reader:
        def __init__(self, opts):
            seen.update(opts)
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def extract_info(self, url, download):
            assert download is False
            return {"title": "Saved video", "duration": 830, "formats": []}

    monkeypatch.setitem(sys.modules, "yt_dlp", SimpleNamespace(YoutubeDL=Reader))
    info = _ytdlp("https://youtu.be/fRVNp0AYoPA")
    assert seen["ignore_no_formats_error"] is True
    assert info.duration_ms == 830000


@pytest.mark.parametrize("height,label", [(2160, "4K"), (1440, "1440p"), (1080, "1080p"),
                                          (720, "720p"), (480, "480p"), (0, "unknown")])
def test_the_badge_over_the_thumbnail(height, label):
    assert quality_label(height) == label


def test_footage_from_a_platform_asks_for_rights_confirmation():
    assert analyze("https://www.youtube.com/watch?v=abc123").needs_rights is True
    assert analyze("https://example.com/my-own-talk.mp4").needs_rights is False


def test_the_options_panel_arrives_pre_filled():
    s = analyze("https://www.youtube.com/watch?v=abc123").suggestions()
    assert s["clip_count"] >= 1
    assert s["clip_length"] in {"auto", "30s~59s", "60s~89s", "90s~3m"}
    assert s["rights_confirmation_required"] is True


def test_a_short_video_suggests_shorter_clips_than_a_long_one():
    short = UrlInfo(url="u", duration_ms=5 * 60_000).suggestions()
    long = UrlInfo(url="u", duration_ms=120 * 60_000).suggestions()
    assert short["clip_length"] == "30s~59s"
    assert long["clip_length"] == "90s~3m"
    assert long["clip_count"] >= short["clip_count"]


def test_something_that_is_not_a_link_is_refused_in_plain_words():
    with pytest.raises(EngineError) as e:
        analyze("just some words")
    assert "link" in str(e.value.message).lower()


def test_a_live_stream_is_refused_rather_than_half_downloaded(monkeypatch):
    from app.pipeline import analyze as mod
    monkeypatch.setattr(mod, "_fake", lambda url: UrlInfo(url=url, duration_ms=1000, is_live=True))
    with pytest.raises(EngineError) as e:
        analyze("https://www.youtube.com/watch?v=live")
    assert "live" in str(e.value.message).lower()


def test_a_video_over_the_length_limit_is_refused(monkeypatch):
    from app.config import settings
    from app.pipeline import analyze as mod
    cfg = settings()
    monkeypatch.setattr(mod, "_fake", lambda url: UrlInfo(
        url=url, duration_ms=(cfg.max_source_seconds + 60) * 1000))
    with pytest.raises(EngineError):
        analyze("https://example.com/very-long.mp4")


@pytest.mark.parametrize("raw,expected", [
    ("ERROR: Private video. Sign in", "private"),
    ("Video unavailable", "unavailable"),
    ("Unsupported URL: https://nope", "not from a site"),
    ("ERROR: [youtube] abc: Requested format is not available.", "usable video format"),
    ("Sign in to confirm you're not a bot", "not a bot"),
    ("HTTP Error 429: Too Many Requests", "rate-limiting"),
    ("This video is not available in your country", "blocked in the region"),
])
def test_importer_errors_are_rewritten_for_creators(raw, expected):
    assert expected in _friendly(raw).lower()


def test_the_endpoint_returns_the_card_the_dashboard_draws(api):
    r = api.post("/v1/analyze", json={"url": "https://www.youtube.com/watch?v=abc123"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    for key in ("title", "duration_ms", "duration_s", "thumbnail_url", "quality", "suggested"):
        assert key in body, key
