from app.pipeline.ingest import link_format, max_link_height


def test_caps_at_1080_by_default(monkeypatch):
    monkeypatch.delenv("YTDLP_MAX_HEIGHT", raising=False)
    assert max_link_height() == 1080
    assert link_format().startswith("bv*[height<=1080][vcodec^=avc1][protocol^=http]+ba[ext=m4a]")


def test_env_sets_the_cap_within_bounds(monkeypatch):
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "720")
    assert max_link_height() == 720
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "99999")
    assert max_link_height() == 2160
    monkeypatch.setenv("YTDLP_MAX_HEIGHT", "junk")
    assert max_link_height() == 1080


def test_uncapped_choice_is_only_the_last_resort():
    choices = link_format(1080).split("/")
    assert choices[-2:] == ["bv*+ba", "b"]
    assert all("height<=1080" in c for c in choices[:-2])
    assert all("protocol^=http" in c for c in choices[:3])


def test_a_refused_stream_counts_as_blocked():
    from app.pipeline.ytdlp_opts import looks_blocked
    assert looks_blocked("ERROR: The downloaded file is empty")
    assert looks_blocked("ERROR: unable to download video data: HTTP Error 403: Forbidden")
    assert looks_blocked("HTTP Error 429: Too Many Requests")
    assert not looks_blocked("ERROR: [youtube] abc: Private video")
    assert not looks_blocked("ERROR: [youtube] abc: This video is unavailable")


def test_a_client_without_the_format_is_worth_another_route():
    from app.pipeline.ingest import _route_lacks_format
    assert _route_lacks_format("ERROR: [youtube] abc: Requested format is not available. Use --list-formats")
    assert not _route_lacks_format("ERROR: [youtube] abc: Private video")
