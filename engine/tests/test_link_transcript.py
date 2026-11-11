"""Reading a pasted link: description and the video's own captions, nothing downloaded."""
from app.config import settings
from app.pipeline.analyze import analyze, parse_json3, pick_caption_track


def test_captions_become_timed_lines():
    data = {"events": [
        {"tStartMs": 0, "dDurationMs": 2000, "segs": [{"utf8": "Hello "}, {"utf8": "there"}]},
        {"tStartMs": 2000, "dDurationMs": 10, "segs": [{"utf8": "\n"}]},
        {"tStartMs": 2500, "dDurationMs": 1500, "segs": [{"utf8": "  second\nline "}]},
    ]}
    assert parse_json3(data) == [
        {"start_ms": 0, "end_ms": 2000, "text": "Hello there"},
        {"start_ms": 2500, "end_ms": 4000, "text": "second line"},
    ]


def _track(url):
    return [{"ext": "vtt", "url": url + ".vtt"}, {"ext": "json3", "url": url}]


def test_the_creators_own_captions_win():
    raw = {"language": "en", "subtitles": {"en": _track("own")}, "automatic_captions": {"en": _track("auto")}}
    assert pick_caption_track(raw) == ("en", "own")


def test_automatic_captions_in_the_videos_language_are_next():
    raw = {"language": "es", "subtitles": {}, "automatic_captions": {"en": _track("en"), "es": _track("es")}}
    assert pick_caption_track(raw) == ("es", "es")


def test_regional_variants_count():
    raw = {"language": "", "subtitles": {}, "automatic_captions": {"de": _track("de"), "en-US": _track("us")}}
    assert pick_caption_track(raw) == ("en-US", "us")


def test_no_captions_is_not_an_error():
    assert pick_caption_track({"language": "en"}) == ("", "")


def test_a_read_returns_the_transcript_only_when_asked(monkeypatch):
    monkeypatch.setattr(settings(), "analyze_provider", "fake", raising=False)
    plain = analyze("https://www.youtube.com/watch?v=abc123").payload()
    full = analyze("https://www.youtube.com/watch?v=abc123", transcript=True).payload()
    assert plain["transcript"] == []
    assert full["transcript"][0]["text"] == "Welcome to the sample."
    assert full["description"]


def test_the_endpoint_passes_the_choice_through(api, monkeypatch):
    monkeypatch.setattr(settings(), "analyze_provider", "fake", raising=False)
    body = api.post("/v1/analyze", json={"url": "https://www.youtube.com/watch?v=abc123", "transcript": True}).json()
    assert body["transcript"]
