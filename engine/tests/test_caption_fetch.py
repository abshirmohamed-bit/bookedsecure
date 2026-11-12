from app.pipeline import analyze


def test_a_direct_refusal_is_retried_through_the_proxy(monkeypatch):
    monkeypatch.setenv("YTDLP_PROXY", "http://user:pass@proxy:823")
    calls = []

    def fake(url, proxy=""):
        calls.append(proxy)
        if not proxy:
            raise RuntimeError("429 Too Many Requests")
        return [{"start_ms": 0, "end_ms": 1000, "text": "hi"}]

    monkeypatch.setattr(analyze, "_fetch_json3", fake)
    assert analyze.fetch_captions("https://example/track", used_proxy=False)[0]["text"] == "hi"
    assert calls == ["", "http://user:pass@proxy:823"]


def test_details_read_through_the_proxy_use_it_straight_away(monkeypatch):
    monkeypatch.setenv("YTDLP_PROXY", "http://p:823")
    calls = []
    monkeypatch.setattr(analyze, "_fetch_json3", lambda url, proxy="": calls.append(proxy) or [])
    analyze.fetch_captions("https://example/track", used_proxy=True)
    assert calls == ["http://p:823"]


def test_without_a_proxy_a_refusal_still_fails(monkeypatch):
    monkeypatch.delenv("YTDLP_PROXY", raising=False)

    def fake(url, proxy=""):
        raise RuntimeError("429")

    monkeypatch.setattr(analyze, "_fetch_json3", fake)
    try:
        analyze.fetch_captions("https://example/track", used_proxy=False)
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected the refusal to surface")
